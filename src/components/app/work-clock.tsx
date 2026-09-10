"use client";

import { startTransition, useActionState, useCallback, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-utils";
import { DEFAULT_TARGET_HOURS_X100, formatDuration, formatHours, STALE_CLOCK_HOURS } from "@/lib/rules/worklog";
import { cn } from "@/lib/utils";
import type { WorkClockState } from "@/modules/worklog/repo";

type Props = {
  state: WorkClockState;
  clockIn: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  clockOut: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  /** 대시보드에서는 한 줄로, 근무 화면에서는 넓게 */
  compact?: boolean;
};

const HOUR_MS = 3_600_000;

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
const noSubscribe = () => () => {};

/** "2026-09-10T09:03:00Z" → "09:03" (보는 사람의 시간대) */
function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function WorkClock({ state, clockIn, clockOut, compact = false }: Props) {
  const router = useRouter();
  const [inState, inAction, inPending] = useActionState<ActionState, FormData>(clockIn, {});
  const [outState, outAction, outPending] = useActionState<ActionState, FormData>(clockOut, {});
  const pending = inPending || outPending;
  const error = inState.error ?? outState.error;

  const running = Boolean(state.clockInAt && !state.clockOutAt);
  const serverNowMs = new Date(state.nowIso).getTime();
  const nowMs = useSyncExternalStore(
    running ? subscribeTick : noSubscribe,
    useCallback(() => (running ? tickMs : serverNowMs), [running, serverNowMs]),
    useCallback(() => serverNowMs, [serverNowMs]),
  );

  // 저장이 끝나면 서버 값을 다시 받아 온다 (useActionState 는 결과마다 새 객체를 준다)
  useEffect(() => {
    if (inState.ok || outState.ok) router.refresh();
  }, [inState, outState, router]);

  const startMs = state.clockInAt ? new Date(state.clockInAt).getTime() : null;
  const endMs = state.clockOutAt ? new Date(state.clockOutAt).getTime() : null;
  const elapsedMs = startMs === null ? 0 : (endMs ?? nowMs) - startMs;
  const target = state.targetHoursX100 || DEFAULT_TARGET_HOURS_X100;
  const targetMs = (target / 100) * HOUR_MS;
  const stale = running && elapsedMs > STALE_CLOCK_HOURS * HOUR_MS;

  // 게이지는 예정 시간까지 파랑, 넘어선 만큼은 초과근무 색으로 이어 붙인다
  const withinPct = Math.min(100, (elapsedMs / targetMs) * 100);
  const overPct = Math.min(100, Math.max(0, ((elapsedMs - targetMs) / targetMs) * 100));

  const display = formatDuration(elapsedMs);
  const recorded = state.clockOutAt ? formatHours(state.hoursX100) : null;

  return (
    <div data-slot="work-clock" className={cn("rounded-lg bg-card ring-1 ring-border", compact ? "px-4 py-3" : "px-5 py-4")}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            내 근무
            {state.clockInAt ? <span className="ml-2 tabular-nums">출근 {hhmm(state.clockInAt)}</span> : null}
            {state.clockOutAt ? <span className="ml-2 tabular-nums">· 퇴근 {hhmm(state.clockOutAt)}</span> : null}
          </p>
          <p className={cn("mt-1 leading-none font-semibold tracking-tight tabular-nums", compact ? "text-2xl" : "text-[34px]")}>
            {display}
            {recorded ? <span className="ml-2 text-sm font-normal text-muted-foreground">기록 {recorded}시간</span> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.locked ? (
            <span className="text-sm text-muted-foreground">본사 확인 완료</span>
          ) : running ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                startTransition(() => outAction(fd));
              }}
            >
              <input type="hidden" name="date" value={state.date} />
              <Button type="submit" disabled={pending} className="touch-target px-6">
                {outPending ? "기록 중…" : "퇴근"}
              </Button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                startTransition(() => inAction(fd));
              }}
            >
              <input type="hidden" name="date" value={state.date} />
              <Button type="submit" disabled={pending} variant={state.clockOutAt ? "outline" : "default"} className="touch-target px-6">
                {inPending ? "기록 중…" : state.clockOutAt ? "다시 출근" : "출근"}
              </Button>
            </form>
          )}
        </div>
      </div>

      {/*
        예정 시간까지는 막대가 차오르고, 넘어서면 초과분이 뒤에 이어 붙는다.
        두 조각의 합이 100% 를 넘으면 flex 가 비율을 지키며 줄여 주므로, 예정을 넘긴 뒤에는
        막대가 늘 가득 찬 채로 '예정 : 초과' 비율을 보여 준다. 잘라내는 것보다 읽기 쉽다.
      */}
      <div className="mt-3">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={target / 100} aria-valuenow={Math.round((elapsedMs / HOUR_MS) * 100) / 100} aria-label="오늘 근무 진행">
          <div className={cn("h-full transition-[width] duration-1000 ease-linear", running ? "bg-primary" : "bg-primary/70")} style={{ width: `${withinPct}%` }} />
          {overPct > 0 ? <div className="h-full bg-warning transition-[width] duration-1000 ease-linear" style={{ width: `${overPct}%` }} /> : null}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          예정 {formatHours(target)}시간
          {overPct > 0 ? <span className="ml-2 font-medium text-warning">예정보다 {formatHours(Math.round(((elapsedMs - targetMs) / HOUR_MS) * 100))}시간 더</span> : null}
          {!state.clockInAt ? <span className="ml-2">출근을 누르면 시간이 흐릅니다</span> : null}
        </p>
      </div>

      {stale ? <p className="mt-2 text-xs break-keep text-warning">{STALE_CLOCK_HOURS}시간이 넘었습니다. 퇴근을 누르지 않은 것 같으면 지점장에게 수정을 요청하세요.</p> : null}
      {error ? <p className="mt-2 text-xs break-keep text-destructive">{error}</p> : null}
    </div>
  );
}
