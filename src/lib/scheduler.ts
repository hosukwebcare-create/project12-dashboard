/**
 * 앱 프로세스 안에서 배치를 주기 실행한다 (별도 크론 서비스 없이 Railway·Cloud Run 한 서비스로 운영하기 위함).
 *
 * - 같은 배치가 겹쳐 도는 것은 Postgres 자문 잠금(advisory lock)으로 막는다. 인스턴스를 늘려도 한 번만 돈다.
 * - 잠금을 못 잡으면 조용히 건너뛴다. 다음 주기에 다시 시도한다.
 * - 끄려면 SCHEDULER=off. 개발 모드에서는 기본으로 꺼져 있고 SCHEDULER=on 일 때만 돈다.
 *
 * 주기는 환경 변수로 조절한다 (초 단위):
 *   SCHEDULER_OUTBOX_SEC   기본 60    메신저 웹훅 전송
 *   SCHEDULER_ALIMTALK_SEC 기본 300   알림톡 발송
 *   SCHEDULER_RETENTION_AT 기본 4     보관기간 지난 회원 익명화를 도는 시각(0~23시)
 */
import { getSql } from "@/db/client";

/** 다른 앱과 겹치지 않도록 고른 자문 잠금 네임스페이스 */
const LOCK_NS = 6931;

/** 배치별 잠금 번호. 앱 안 스케줄러와 /api/jobs/* 가 같은 번호를 써야 서로 겹치지 않는다 */
export const JOB_LOCK = { outbox: 1, alimtalk: 2, retention: 3 } as const;

type Job = {
  name: string;
  /** LOCK_NS 안에서 배치를 구분하는 번호 */
  key: number;
  everyMs: number;
  /** 이번 틱에 실제로 돌아야 하는지 (하루 1회처럼 시각이 정해진 배치용) */
  due?: (now: Date) => boolean;
  run: () => Promise<unknown>;
};

function envSec(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const RETENTION_HOUR = (() => {
  const n = Number(process.env.SCHEDULER_RETENTION_AT ?? 4);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 4;
})();

/** 오늘 이미 돈 하루 1회 배치 (프로세스가 재시작되면 초기화되지만 익명화는 여러 번 돌아도 결과가 같다) */
let retentionRanOn = "";

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const JOBS: Job[] = [
  {
    name: "outbox",
    key: JOB_LOCK.outbox,
    everyMs: envSec("SCHEDULER_OUTBOX_SEC", 60) * 1000,
    run: async () => {
      const { dispatchOutbox } = await import("@/modules/outbox/repo");
      return dispatchOutbox(undefined, 100);
    },
  },
  {
    name: "alimtalk",
    key: JOB_LOCK.alimtalk,
    everyMs: envSec("SCHEDULER_ALIMTALK_SEC", 300) * 1000,
    run: async () => {
      const [{ getProvider }, { processQueue }] = await Promise.all([import("@/modules/alimtalk/provider"), import("@/modules/alimtalk/repo")]);
      return processQueue(getProvider(), 500);
    },
  },
  {
    name: "retention",
    key: JOB_LOCK.retention,
    everyMs: 30 * 60 * 1000,
    due: (now) => now.getHours() === RETENTION_HOUR && retentionRanOn !== dayKey(now),
    run: async () => {
      const { anonymizeWithdrawnMembers, DEFAULT_RETENTION_DAYS } = await import("@/modules/retention/repo");
      const days = Number(process.env.RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
      const result = await anonymizeWithdrawnMembers({ retentionDays: Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS });
      retentionRanOn = dayKey(new Date());
      return result;
    },
  },
];

/**
 * 자문 잠금을 잡은 동안만 fn 을 실행한다. 잠금은 커넥션에 붙으므로 풀에서 하나를 예약해서 쓴다.
 * 잠금을 못 잡으면(다른 인스턴스가 도는 중) null 을 돌려준다.
 */
export async function withJobLock<T>(key: number, fn: () => Promise<T>): Promise<T | null> {
  const reserved = await getSql().reserve();
  try {
    const [got] = await reserved<{ ok: boolean }[]>`select pg_try_advisory_lock(${LOCK_NS}, ${key}) as ok`;
    if (!got?.ok) return null;
    try {
      return await fn();
    } finally {
      await reserved`select pg_advisory_unlock(${LOCK_NS}, ${key})`;
    }
  } finally {
    reserved.release();
  }
}

/** 결과에 처리 건수가 있으면 로그를 남기고, 할 일이 없었으면 조용히 지나간다 */
function logResult(name: string, result: unknown): void {
  if (!result || typeof result !== "object") return;
  const counts = Object.values(result).filter((v) => typeof v === "number") as number[];
  if (counts.some((n) => n > 0)) console.log(`[batch] ${name} ${JSON.stringify(result)}`);
}

function schedule(job: Job): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (running) return; // 이전 실행이 아직 안 끝났다
    if (job.due && !job.due(new Date())) return;
    running = true;
    try {
      const result = await withJobLock(job.key, job.run);
      if (result !== null) logResult(job.name, result);
    } catch (e) {
      console.error(`[batch] ${job.name} 실패`, e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, job.everyMs);
  timer.unref?.(); // 배치 타이머가 프로세스 종료를 막지 않게
  return timer;
}

let timers: NodeJS.Timeout[] | null = null;

/** 서버 기동 시 한 번 호출한다 (instrumentation). 이미 켜져 있으면 아무것도 하지 않는다. */
export function startScheduler(): void {
  if (timers) return;
  if (process.env.SCHEDULER === "off" || !process.env.DATABASE_URL) return;
  if (process.env.NODE_ENV !== "production" && process.env.SCHEDULER !== "on") return;
  timers = JOBS.map(schedule);
  const every = JOBS.map((j) => `${j.name} ${Math.round(j.everyMs / 1000)}초`).join(", ");
  console.log(`[batch] 스케줄러 시작 (${every}, 익명화는 매일 ${RETENTION_HOUR}시)`);
}

/** 스케줄러가 이 프로세스에서 돌고 있는지 (/api/health 로 밖에서 확인한다) */
export function schedulerRunning(): boolean {
  return timers !== null;
}

/** 테스트·종료용 */
export function stopScheduler(): void {
  timers?.forEach(clearInterval);
  timers = null;
}
