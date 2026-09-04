import type { Grade } from "@/db/schema";

export type PointRow = { grade: Grade; points: number };

/** 벌점(p) 행의 점수만 합산 */
export function sumPoints(rows: PointRow[]): number {
  return rows.reduce((acc, r) => (r.grade === "p" ? acc + r.points : acc), 0);
}

/** 등급과 규칙 점수로 기록에 남길 점수를 정한다 (스냅샷) */
export function pointsFor(grade: Grade, rulePoints: number | null | undefined): number {
  if (grade !== "p") return 0;
  return rulePoints ?? 0;
}
