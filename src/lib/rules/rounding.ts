import type { BoardItemKind, Grade } from "@/db/schema";

/** 아직 만들지 않은(또는 완료하지 않은) 가장 작은 회차. 하루 회차를 모두 썼으면 null */
export function nextRoundNo(existing: number[], roundsPerDay: number): number | null {
  const used = new Set(existing);
  for (let n = 1; n <= roundsPerDay; n++) {
    if (!used.has(n)) return n;
  }
  return null;
}

/**
 * '나머지 전원 a'를 허용하는 항목인가. 출석은 안 된다 —
 * 출석은 라운딩에서 저절로 채워지고, 한꺼번에 '왔다'고 적으면 결석이 출석으로 바뀐다.
 */
export function canFillRest(itemKey: string): boolean {
  return itemKey !== "attendance" && itemKey !== "round";
}

/** 출석 칸의 키. 이 칸은 적지 않고 라운딩에서 채운다 */
export const ATTENDANCE_KEY = "attendance";
/** 라운딩 칸의 키. 현황판 항목의 키가 무엇이든 회차 기록은 이 키로 쌓인다(세션·출석·완료가 모두 이 키를 본다) */
export const ROUND_KEY = "round";

/** 라운딩에서 저절로 채운 출석에 붙는 메모. 사람이 적은 출석과 구별해, 사람이 적은 것은 덮어쓰지 않는다 */
export const AUTO_ATTENDANCE_NOTE = "라운딩에서 자동";

/**
 * 자동으로 채운 출석인가.
 * 예전 형식("R3 라운딩에서 확인")은 예전 화면이 사람이 고칠 때도 메모를 그대로 두었기 때문에,
 * 그 자동 입력이 남긴 모양(양호 · 점수 0 · 등원 시각·CALL 없음) 그대로일 때만 자동으로 본다.
 * 사람이 지각·b 로 고쳐 둔 줄은 사람이 적은 것이다.
 */
export function isAutoAttendance(row: { note: string | null | undefined; grade?: Grade; points?: number; arrivalTime?: string | null; called?: boolean | null }): boolean {
  if (!row.note) return false;
  if (row.note === AUTO_ATTENDANCE_NOTE) return true;
  if (!/^R\d+ 라운딩에서 확인$/.test(row.note)) return false;
  return (row.grade ?? "a") === "a" && !row.points && !row.arrivalTime && !row.called;
}

/**
 * 그날 라운딩 모습으로 출석을 정한다. 시트 249일 8,831칸에서 확인한 규칙:
 * 한 번이라도 자리에서 봤으면(a·벌점) 출석 a, 온종일 사유로 자리에 없었으면(b) 출석 b.
 * 시트의 87%가 이 규칙과 같고, 나머지는 사람이 따로 판단한 지각·누락이다.
 */
export function deriveAttendance(roundGrades: Grade[]): Grade | null {
  if (roundGrades.some((g) => g === "a" || g === "p")) return "a";
  if (roundGrades.some((g) => g === "b")) return "b";
  if (roundGrades.some((g) => g === "na")) return "na";
  return null;
}

/**
 * 직전 회차 값을 이어받을 때의 등급. 시트에서 윗줄을 끌어내리는 것과 같다.
 * 벌점은 그 순간의 일이라 옮기지 않는다 — 벌점을 받았어도 자리에 있었으니 a.
 */
export function carryForwardGrade(prev: Grade): Grade {
  return prev === "p" ? "a" : prev;
}

/**
 * 같은 날 앞 회차에 졸음이 있었으면 '졸음'을 '연속 졸음'으로 올린다(예전 벌점 창이 먼저 골라 주던 규칙).
 * 펜·글쇠로 바로 적을 때도 같은 점수가 나오게 한다. 올릴 규칙이 없으면 고른 그대로.
 */
export function escalateSleepy(rules: { id: string; name: string }[], ruleId: string, earlierRuleIds: (string | null)[]): string {
  const chosen = rules.find((r) => r.id === ruleId);
  if (!chosen || !chosen.name.includes("졸음") || chosen.name.includes("연속")) return ruleId;
  const earlierSleepy = earlierRuleIds.some((id) => (rules.find((r) => r.id === id)?.name ?? "").includes("졸음"));
  if (!earlierSleepy) return ruleId;
  const consecutive = rules.find((r) => r.name.includes("연속") && r.name.includes("졸음")) ?? rules.find((r) => r.name.includes("연속"));
  return consecutive?.id ?? ruleId;
}

/** 하루 표의 한 열. 출석은 라운딩에서 채우는 자동 열이다 */
export type DayColumn = {
  itemKey: string;
  /** 라운딩이면 1..n, 일별 항목이면 0 */
  roundNo: number;
  label: string;
  kind: "auto" | "daily" | "round";
  /** 회차 시간표 "HH:mm" */
  time: string | null;
};

/**
 * 현황판 항목 순서 그대로 하루 표(와 현황판·회원 주간표)의 열을 만든다: 출석·플래너·R1…Rn·영단어·점검완료.
 * - 라운딩 열은 항목 키와 상관없이 ROUND_KEY 로 쌓는다. 라운딩 항목이 둘이어도 한 번만 펼친다.
 * - 라운딩 항목이 없는 지점도 회차는 돈다(예전에는 회차 수만으로 라운딩을 했다) — 그때는 맨 뒤에 붙인다.
 * - rounds 는 보통 지점의 하루 회차 수이고, 그날 그보다 많은 회차가 기록돼 있으면(이관한 R12 등) 그만큼 늘려 받는다.
 */
export function dayColumns(items: { key: string; label: string; kind: BoardItemKind }[], rounds: number, schedule: string[] = []): DayColumn[] {
  const out: DayColumn[] = [];
  const roundCols = () => Array.from({ length: rounds }, (_, i) => ({ itemKey: ROUND_KEY, roundNo: i + 1, label: `R${i + 1}`, kind: "round" as const, time: schedule[i] || null }));
  let placed = false;
  for (const item of items) {
    if (item.kind === "round") {
      if (!placed) out.push(...roundCols());
      placed = true;
    } else {
      out.push({ itemKey: item.key, roundNo: 0, label: item.label, kind: item.key === ATTENDANCE_KEY ? "auto" : "daily", time: null });
    }
  }
  if (!placed) out.push(...roundCols());
  return out;
}

/** 하루 표 칸의 주소. 서버와 화면이 같은 모양을 쓴다(날짜는 표 하나가 하루이므로 넣지 않는다) */
export function cellKey(memberId: string, itemKey: string, roundNo: number): string {
  return `${memberId}|${itemKey}|${roundNo}`;
}

/** 하루 표 한 칸의 값. 출석 칸은 auto 로 라운딩에서 채운 것인지 표시한다 */
export type DayCell = { grade: Grade; points: number; penaltyRuleId: string | null; note: string | null; isIssue: boolean; auto: boolean };

/** 라운딩에서 채운 출석 칸. 서버(syncAttendance)와 화면(미리 보여 주기)이 같은 모양을 쓴다 */
export function autoAttendanceCell(grade: Grade): DayCell {
  return { grade, points: 0, penaltyRuleId: null, note: AUTO_ATTENDANCE_NOTE, isIssue: false, auto: true };
}
