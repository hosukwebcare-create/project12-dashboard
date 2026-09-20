import type { StaffGroup } from "@/db/schema";

export type { StaffGroup };
export type SlotSpec = { key: string; hoursX100: number; weekend: boolean };

/** 근무일지의 직군. 조교·원장·멘토는 근무 시간대가 서로 달라 타임표를 따로 쓴다 */
export const STAFF_GROUPS: { key: StaffGroup; label: string }[] = [
  { key: "assistant", label: "조교" },
  { key: "manager", label: "원장" },
  { key: "mentor", label: "멘토" },
];
export const STAFF_GROUP_LABEL: Record<StaffGroup, string> = { assistant: "조교", manager: "원장", mentor: "멘토" };

/**
 * 직군을 정한다. 근무 형태를 적어 둔 직원은 그것이 우선이고(계정은 조교인데 원장 일을 하는 경우),
 * 없거나 '기타'면 계정 역할로 본다.
 */
export function staffGroupOf(role: string, employmentType?: string | null): StaffGroup {
  if (employmentType === "주간조교" || employmentType === "야간조교") return "assistant";
  if (employmentType === "컨설팅") return "mentor";
  if (employmentType === "원장") return "manager";
  if (role === "assistant") return "assistant";
  if (role === "mentor") return "mentor";
  return "manager";
}

/** 그날 그 직군이 체크할 수 있는 타임: 평일/주말이 맞고, 자기 직군 것이거나 공통인 것 */
export function slotsForGroup<T extends { weekend: boolean; audience: StaffGroup | null }>(slots: T[], group: StaffGroup, isWeekend: boolean): T[] {
  return slots.filter((s) => s.weekend === isWeekend && (s.audience === null || s.audience === group));
}

/** "07:50"~"15:00" → 717 (7.17시간). 자정을 넘기면 다음 날로 본다 */
export function spanToHoursX100(start: string, end: string): number {
  const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let d = min(end) - min(start);
  if (d < 0) d += 24 * 60;
  return Math.round((d / 60) * 100);
}

/** 직군별 기본 타임. 동탄점이 알려 준 실제 근무 시간대 (2026-09) */
export const GROUP_SLOT_PRESET: { key: string; label: string; audience: StaffGroup; startTime: string; endTime: string }[] = [
  { key: "asst", label: "조교 근무", audience: "assistant", startTime: "07:50", endTime: "15:00" },
  { key: "mgr", label: "원장 근무", audience: "manager", startTime: "16:00", endTime: "23:00" },
  { key: "mentor", label: "멘토 근무", audience: "mentor", startTime: "19:00", endTime: "23:00" },
];

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
