import type { BoardItemKind, Grade } from "@/db/schema";

/** 아직 만들지 않은 가장 작은 회차. 하루 회차를 모두 썼으면 null */
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

/** 라운딩에서 저절로 채운 출석에 붙는 메모. 사람이 적은 출석과 구별해, 사람이 적은 것은 덮어쓰지 않는다 */
export const AUTO_ATTENDANCE_NOTE = "라운딩에서 자동";

/** 자동으로 채운 출석인가. 예전 형식("R3 라운딩에서 확인")도 자동으로 본다 */
export function isAutoAttendance(note: string | null | undefined): boolean {
  if (!note) return false;
  return note === AUTO_ATTENDANCE_NOTE || /^R\d+ 라운딩에서 확인$/.test(note);
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
 * 현황판 항목 순서 그대로 하루 표의 열을 만든다. 시트와 모니터가 쓰는 순서(출석·플래너·R1…Rn·영단어·점검완료)와 같다.
 * 쓰지 않는 항목은 목록에 들어오지 않는다.
 */
export function dayColumns(items: { key: string; label: string; kind: BoardItemKind }[], roundsPerDay: number, schedule: string[] = []): DayColumn[] {
  const out: DayColumn[] = [];
  for (const item of items) {
    if (item.kind === "round") {
      for (let n = 1; n <= roundsPerDay; n++) out.push({ itemKey: item.key, roundNo: n, label: `R${n}`, kind: "round", time: schedule[n - 1] || null });
    } else {
      out.push({ itemKey: item.key, roundNo: 0, label: item.label, kind: item.key === ATTENDANCE_KEY ? "auto" : "daily", time: null });
    }
  }
  return out;
}

/** 하루 표 칸의 주소. 서버와 화면이 같은 모양을 쓴다 */
export function cellKey(memberId: string, itemKey: string, roundNo: number): string {
  return `${memberId}|${itemKey}|${roundNo}`;
}

/**
 * 오늘 지금 돌 차례인 회차. 완료하지 않은 가장 이른 회차이고, 다 끝났으면 null.
 * 시간표가 있으면 아직 시작 시각이 안 된 회차는 건너뛰지 않는다 — 앞 회차부터 끝내야 한다.
 */
export function currentRound(roundsPerDay: number, completed: number[]): number | null {
  const done = new Set(completed);
  for (let n = 1; n <= roundsPerDay; n++) if (!done.has(n)) return n;
  return null;
}
