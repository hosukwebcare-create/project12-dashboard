import type { MealKind } from "@/db/schema";
import { toDate, toDateKey } from "./week";

export type MealPolicy = { cutoffTime: string; saturdayLunchOnly: boolean; sundayClosed: boolean; closedDates: string[] };

/** 해당 날짜·끼니에 주문이 가능한가 (요일·휴무 정책) */
export function isMealAvailable(date: string, meal: MealKind, policy: MealPolicy): boolean {
  if (policy.closedDates.includes(date)) return false;
  const dow = toDate(date).getDay();
  if (dow === 0 && policy.sundayClosed) return false;
  if (dow === 6 && policy.saturdayLunchOnly && meal === "dinner") return false;
  return true;
}

/** 주문 변경 마감 시각 = 전날 cutoffTime */
export function mealDeadline(date: string, cutoffTime: string): Date {
  const [h, m] = cutoffTime.split(":").map(Number);
  const d = toDate(date);
  d.setDate(d.getDate() - 1);
  d.setHours(h, m, 0, 0);
  return d;
}

export function isOrderLocked(date: string, cutoffTime: string, now: Date): boolean {
  return now.getTime() >= mealDeadline(date, cutoffTime).getTime();
}

/** 'YYYY-MM' → 그 달의 모든 날짜 키 */
export function monthDates(yearMonth: string): string[] {
  const [y, m] = yearMonth.split("-").map(Number);
  const out: string[] = [];
  const d = new Date(y, m - 1, 1);
  while (d.getMonth() === m - 1) {
    out.push(toDateKey(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function isValidCutoff(v: string): boolean {
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}
