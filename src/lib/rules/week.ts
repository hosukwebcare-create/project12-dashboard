/** 날짜 규칙: 주는 월요일에 시작한다. 모든 날짜 키는 로컬 'YYYY-MM-DD'. */

export type DateInput = Date | string;

export function toDate(d: DateInput): Date {
  if (d instanceof Date) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
}

export function toDateKey(d: DateInput): string {
  const x = toDate(d);
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${mm}-${dd}`;
}

export function addDays(d: DateInput, n: number): Date {
  const x = toDate(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 해당 주의 월요일 00:00 */
export function weekStart(d: DateInput): Date {
  const x = toDate(d);
  const dow = x.getDay(); // 0=일 … 6=토
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(x, -back);
}

export function weekDays(start: DateInput): Date[] {
  const s = weekStart(start);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/** 주 시작(월요일)이 해당 월에 속하는 주들의 시작일 */
export function weeksInMonth(year: number, month1to12: number): Date[] {
  const out: Date[] = [];
  const first = new Date(year, month1to12 - 1, 1);
  let cur = weekStart(first);
  if (cur.getMonth() !== first.getMonth()) cur = addDays(cur, 7);
  while (cur.getMonth() === month1to12 - 1) {
    out.push(cur);
    cur = addDays(cur, 7);
  }
  return out;
}

export function todayKey(): string {
  return toDateKey(new Date());
}
