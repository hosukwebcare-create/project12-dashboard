"use client";

import { startTransition, useActionState, useCallback, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-utils";
import { DEFAULT_TARGET_HOURS_X100, formatHours, STALE_CLOCK_HOURS } from "@/lib/rules/worklog";
import { cn } from "@/lib/utils";
import type { WorkClockState } from "@/modules/worklog/repo";

type Props = {
  state: WorkClockState;
  clockIn: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  clockOut: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  /** 대시보드에서는 링을 작게 눕히고, 근무 화면에서는 크게 세운다 */
  compact?: boolean;
};

const HOUR_MS = 3_600_000;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 1초마다 도는 시계 하나를 여러 카드가 나눠 쓴다.
 * useState 를 effect 안에서 부르는 대신 외부 저장소로 두는 이유: 하이드레이션 때
 * 서버가 그린 시각과 브라우저의 첫 그림이 같아야 글자가 튀지 않는다.
 */
let tickMs = Date.now();
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function subscribeTick(cb: () => void): () => void {
  tickListeners.add(cb);
  tickTimer ??= setInterval(() => {
    tickMs = Date.now();
    for (const l of tickListeners) l();
  }, 1000);
  return () => {
    tickListeners.delete(cb);
    if (tickListeners.size === 0 && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "05h 12m 20s" — 초까지 보여야 살아 있는 느낌이 난다 */
function hms(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(t / 3600))}h ${pad(Math.floor((t % 3600) / 60))}m ${pad(t % 60)}s`;
}

/** 작은 링 안에는 초까지 넣으면 넘친다 */
function hm(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(t / 3600))}h ${pad(Math.floor((t % 3600) / 60))}m`;
}

/** "26-09-10 (목) 13:10:43" */
function stamp(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getFullYear()).slice(2)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${DOW[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function clockAt(iso: string | null): string {
  if (!iso) return "--:--:--";
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 'YYYY-MM-DD' → 'MM-DD' */
const md = (key: string) => key.slice(5);

/**
 * 링 게이지. 한 바퀴가 그날의 근무 예정 시간이다.
 * 예정까지는 파랑으로 차고, 넘어선 만큼은 그 위에 초과근무 색으로 겹쳐 그린다.
 */
function Ring({ pct, overPct, size, value }: { pct: number; overPct: number; size: number; value: string }) {
  const stroke = size >= 180 ? 14 : 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const big = size >= 180;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, pct / 100))}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
        {overPct > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--warning)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.min(1, overPct / 100))}
            className="transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("font-semibold tabular-nums", big ? "text-lg" : "text-sm")}>{Math.round(pct + overPct)}%</span>
        <span className={cn("text-muted-foreground", big ? "mt-1 text-xs" : "text-[10px]")}>근무시간</span>
        <span className={cn("font-semibold tracking-tight tabular-nums", big ? "mt-0.5 text-xl" : "text-xs")}>{value}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm font-semibold tabular-nums", tone === "warning" && "text-warning")}>{value}</p>
    </div>
  );
}

export function WorkClock({ state, clockIn, clockOut, compact = false }: Props) {
  const router = useRouter();
  const [inState, inAction, inPending] = useActionState<ActionState, FormData>(clockIn, {});
  const [outState, outAction, outPending] = useActionState<ActionState, FormData>(clockOut, {});
  const pending = inPending || outPending;
  const error = inState.error ?? outState.error;

  const running = Boolean(state.clockInAt && !state.clockOutAt);
  const serverNowMs = new Date(state.nowIso).getTime();
  // 근무 중이 아니어도 오른쪽 위 시각은 계속 흐른다
  const nowMs = useSyncExternalStore(
    subscribeTick,
    useCallback(() => tickMs, []),
    useCallback(() => serverNowMs, [serverNowMs]),
  );

  useEffect(() => {
    if (inState.ok || outState.ok) router.refresh();
  }, [inState, outState, router]);

  const startMs = state.clockInAt ? new Date(state.clockInAt).getTime() : null;
  const endMs = state.clockOutAt ? new Date(state.clockOutAt).getTime() : null;
  const elapsedMs = startMs === null ? 0 : (endMs ?? nowMs) - startMs;
  const target = state.targetHoursX100 || DEFAULT_TARGET_HOURS_X100;
  const targetMs = (target / 100) * HOUR_MS;
  const stale = running && elapsedMs > STALE_CLOCK_HOURS * HOUR_MS;

  const pct = Math.min(100, (elapsedMs / targetMs) * 100);
  const overPct = Math.min(100, Math.max(0, ((elapsedMs - targetMs) / targetMs) * 100));

  // 이번 주 = 이미 기록된 시간 + 지금 흐르고 있는 시간
  const runningX100 = running ? Math.round((elapsedMs / HOUR_MS) * 100) : 0;
  const weekWorked = state.week.workedX100 + runningX100;
  const weekTarget = state.week.targetX100;
  const weekLeft = Math.max(0, weekTarget - weekWorked);
  const weekPct = weekTarget > 0 ? Math.min(100, (weekWorked / weekTarget) * 100) : 0;

  const greeting = state.locked ? "본사 확인이 끝났습니다." : running ? "근무 중입니다." : state.clockOutAt ? "오늘 퇴근했습니다." : "출근 전입니다.";

  return (
    <div data-slot="work-clock" className="rounded-lg bg-card px-5 py-4 ring-1 ring-border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-medium">오늘</p>
        <p className="text-sm text-muted-foreground tabular-nums">{stamp(nowMs)}</p>
      </div>

      <div className={cn("mt-4 flex flex-wrap items-center", compact ? "gap-x-5 gap-y-4" : "gap-x-7 gap-y-5")}>
        <Ring pct={pct} overPct={overPct} size={compact ? 104 : 184} value={compact ? hm(elapsedMs) : hms(elapsedMs)} />

        <div className={cn("flex-1 space-y-4", compact ? "min-w-52" : "min-w-60")}>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div>
              <p className="leading-snug font-semibold">
                {state.userName}님, 안녕하세요.
                <br />
                {greeting}
              </p>
              <span className="mt-2 inline-block rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">{state.employmentType}</span>
            </div>
            <div className="text-sm text-muted-foreground tabular-nums">
              <p>출근 : {clockAt(state.clockInAt)}</p>
              <p>퇴근 : {clockAt(state.clockOutAt)}</p>
            </div>
          </div>

          {/* 지금 눌러야 하는 쪽이 진하다. 근무 중이면 퇴근이, 아니면 출근이 주 버튼이다 */}
          <div className="flex max-w-sm gap-2">
            <form
              className="flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                startTransition(() => inAction(fd));
              }}
            >
              <input type="hidden" name="date" value={state.date} />
              <Button type="submit" variant={running ? "outline" : "default"} disabled={pending || running || state.locked} className="touch-target w-full">
                {inPending ? "기록 중…" : state.clockOutAt ? "다시 출근" : "출근"}
              </Button>
            </form>
            <form
              className="flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                startTransition(() => outAction(fd));
              }}
            >
              <input type="hidden" name="date" value={state.date} />
              <Button type="submit" variant={running ? "default" : "outline"} disabled={pending || !running || state.locked} className="touch-target w-full">
                {outPending ? "기록 중…" : "퇴근"}
              </Button>
            </form>
          </div>
        </div>
      </div>

      {stale ? <p className="mt-3 text-xs break-keep text-warning">{STALE_CLOCK_HOURS}시간이 넘었습니다. 퇴근을 누르지 않은 것 같으면 지점장에게 수정을 요청하세요.</p> : null}
      {error ? <p className="mt-3 text-xs break-keep text-destructive">{error}</p> : null}

      <div className="mt-5 border-t border-border pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-medium">이번 주</p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {md(state.week.startDate)} ~ {md(state.week.endDate)}
          </p>
        </div>
        <div className={cn("mt-3 grid grid-cols-2 gap-x-4 gap-y-3", !compact && "sm:grid-cols-4")}>
          <Stat label="주 소정근로시간" value={`${formatHours(weekTarget)}h`} />
          <Stat label="누적 근로시간" value={`${formatHours(weekWorked)}h`} />
          <Stat label="잔여 근로시간" value={`${formatHours(weekLeft)}h`} />
          <Stat label="연장 근로시간" value={`${formatHours(state.week.overtimeX100)}h`} tone={state.week.overtimeX100 > 0 ? "warning" : undefined} />
        </div>
        <div className="mt-3">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={weekTarget / 100}
            aria-valuenow={weekWorked / 100}
            aria-label="이번 주 누적 근로시간"
          >
            <div className="h-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${weekPct}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>0</span>
            <span>{formatHours(weekTarget)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
