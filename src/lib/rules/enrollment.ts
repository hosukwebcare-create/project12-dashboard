import { toDate } from "./week";

export type Enrollment = { startDate: string; endDate: string };

/** 오늘을 포함하는 등록 중 시작일이 가장 늦은 것 */
export function currentEnrollment<T extends Enrollment>(list: T[], today: string): T | null {
  const valid = list.filter((e) => e.endDate >= today && e.startDate <= today);
  if (valid.length === 0) return null;
  return valid.sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
}

export function daysLeft(e: Enrollment, today: string): number {
  const ms = toDate(e.endDate).getTime() - toDate(today).getTime();
  return Math.round(ms / 86_400_000);
}

export function isExpiringSoon(e: Enrollment | null, today: string, withinDays = 7): boolean {
  if (!e) return false;
  const left = daysLeft(e, today);
  return left >= 0 && left <= withinDays;
}
