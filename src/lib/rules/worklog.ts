export type SlotSpec = { key: string; hoursX100: number; weekend: boolean };

/** 체크한 타임의 인정 시간(×100) 합계 */
export function computeHoursX100(slots: SlotSpec[], selected: string[]): number {
  const byKey = new Map(slots.map((s) => [s.key, s.hoursX100]));
  return selected.reduce((acc, k) => acc + (byKey.get(k) ?? 0), 0);
}

/** 150 → "1.5", 331 → "3.31", 0 → "0" */
export function formatHours(x100: number): string {
  const s = (x100 / 100).toFixed(2);
  return s.replace(/\.?0+$/, "");
}

/** "0.81" → 81, "" → 0, 잘못된 값 → null */
export function parseHoursToX100(raw: string): number | null {
  const s = raw.trim();
  if (!s) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** 출퇴근 사이 시간(밀리초) → 인정 시간 ×100. 0.01시간(36초) 단위로 반올림한다 */
export function elapsedToHoursX100(fromMs: number, toMs: number): number {
  return Math.max(0, Math.round((toMs - fromMs) / 36_000));
}

/** 초 단위 경과를 "6:03:12" 로. 화면에서 1초마다 다시 그린다 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}`;
}

/** 비워 둔 지점의 기본 근무 예정 시간 (8시간) */
export const DEFAULT_TARGET_HOURS_X100 = 800;

/**
 * 퇴근을 누르지 않고 하루가 넘어간 것으로 보는 기준.
 * 이 시간을 넘으면 타이머를 계속 키우는 대신 "퇴근을 누르지 않은 것 같다"고 알린다.
 */
export const STALE_CLOCK_HOURS = 16;
