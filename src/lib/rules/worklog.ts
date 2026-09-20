import type { SlotAudience, StaffGroup } from "@/db/schema";

export type { SlotAudience, StaffGroup };
/** 인정 시간은 분으로 적어 둔다. minutes 가 비어 있는 것은 분 단위가 생기기 전에 만든 타임이다 */
export type SlotSpec = { key: string; hoursX100: number; minutes: number | null; weekend: boolean };

/** 근무일지 화면을 나누는 직군. 조교·원장·멘토 세 묶음이다 */
export const STAFF_GROUPS: { key: StaffGroup; label: string }[] = [
  { key: "assistant", label: "조교" },
  { key: "manager", label: "원장" },
  { key: "mentor", label: "멘토" },
];
export const STAFF_GROUP_LABEL: Record<StaffGroup, string> = { assistant: "조교", manager: "원장", mentor: "멘토" };

/** 타임표는 직군보다 한 단 더 잘게 나뉜다. 같은 조교라도 주간과 야간의 타임이 다르다 */
export const SLOT_AUDIENCES: SlotAudience[] = ["주간조교", "야간조교", "컨설팅", "원장"];

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

/**
 * 그날 이 근무 형태가 체크할 수 있는 타임: 요일이 맞고, 자기 형태 것이거나 공통인 것.
 * 시트는 토요일에도 1~7타임을 쓰고 일요일에만 일1·일2타임을 쓴다 — 그래서 기준은 주말이 아니라 일요일이다.
 */
export function slotsForAudience<T extends { weekend: boolean; audience: SlotAudience | null }>(slots: T[], employmentType: string, sunday: boolean): T[] {
  return slots.filter((s) => s.weekend === sunday && (s.audience === null || s.audience === employmentType));
}

/**
 * 동탄점 근무일지 시트의 타임표를 그대로 옮긴 값. 2026년 1~9월 급여 기초가 이 수식으로 계산됐다.
 * 시트 N열: 주간조교 (1타임×60 + 2~7타임×15 + 일1·일2×30)/60, 야간조교 (1~3타임×10 + 일1·일2×30)/60,
 * 컨설팅 1타임×240/60, 원장 1타임×6. 평일을 다 체크하면 주간조교 2.5시간, 야간조교 0.5시간이 된다.
 * 시각이 적혀 있는 것은 근무시간표 탭의 원장 16:00~23:00 하나뿐이라 나머지는 비워 둔다.
 */
export const SHEET_SLOT_PRESET: { key: string; label: string; audience: SlotAudience; minutes: number; sunday: boolean; startTime: string; endTime: string }[] = [
  ...[60, 15, 15, 15, 15, 15, 15].map((minutes, i) => ({ key: `d${i + 1}`, label: `${i + 1}타임`, audience: "주간조교" as const, minutes, sunday: false, startTime: "", endTime: "" })),
  ...[1, 2].map((n) => ({ key: `dsun${n}`, label: `일${n}타임`, audience: "주간조교" as const, minutes: 30, sunday: true, startTime: "", endTime: "" })),
  ...[10, 10, 10].map((minutes, i) => ({ key: `n${i + 1}`, label: `${i + 1}타임`, audience: "야간조교" as const, minutes, sunday: false, startTime: "", endTime: "" })),
  ...[1, 2].map((n) => ({ key: `nsun${n}`, label: `일${n}타임`, audience: "야간조교" as const, minutes: 30, sunday: true, startTime: "", endTime: "" })),
  { key: "c1", label: "1타임", audience: "컨설팅", minutes: 240, sunday: false, startTime: "", endTime: "" },
  { key: "m1", label: "1타임", audience: "원장", minutes: 360, sunday: false, startTime: "16:00", endTime: "23:00" },
];

/**
 * 직군별 기본 타임을 처음 넣었을 때 만들어진 타임 세 개. 시작~끝 길이를 인정 시간으로 써서
 * 시트보다 길게 잡혔다(조교 7.17h, 원장 7h). 기록이 이 키를 가리키고 있으므로 지우지 않고 시트 값으로 고친다.
 */
export const LEGACY_SLOT_FIX: Record<string, { audience: SlotAudience; minutes: number }> = {
  asst: { audience: "주간조교", minutes: 150 },
  mgr: { audience: "원장", minutes: 360 },
  mentor: { audience: "컨설팅", minutes: 240 },
};

/** 분 → 인정 시간 ×100. 시트처럼 분을 먼저 다 더한 뒤 한 번만 나눈다 */
export function minutesToHoursX100(minutes: number): number {
  return Math.round((minutes / 60) * 100);
}

/**
 * 체크한 타임의 인정 시간(×100) 합계.
 * 분이 적힌 타임은 분끼리 먼저 더한다 — 10분짜리 타임 셋을 따로 반올림하면 0.5가 아니라 0.51이 된다.
 */
export function computeHoursX100(slots: SlotSpec[], selected: string[]): number {
  const byKey = new Map(slots.map((s) => [s.key, s]));
  let minutes = 0;
  let x100 = 0;
  for (const key of selected) {
    const slot = byKey.get(key);
    if (!slot) continue;
    if (slot.minutes === null) x100 += slot.hoursX100;
    else minutes += slot.minutes;
  }
  return x100 + minutesToHoursX100(minutes);
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

/** "15" → 15분, "" → 0, 잘못된 값 → null */
export function parseMinutes(raw: string): number | null {
  const s = raw.trim();
  if (!s) return 0;
  if (!/^\d{1,4}$/.test(s)) return null;
  return Number(s);
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
