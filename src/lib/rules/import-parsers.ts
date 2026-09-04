import { toDateKey } from "./week";

/** "이상윤/S" → 단기 회원 표시 분리 */
export function splitNameSuffix(raw: string): { name: string; short: boolean } {
  const m = raw.trim().match(/^(.*?)\s*\/\s*[sS]\s*$/);
  if (m) return { name: m[1].trim(), short: true };
  return { name: raw.trim(), short: false };
}

/** "한백고3" / "가온고 2" → 학교·학년 */
export function splitSchoolGrade(raw: string): { school: string | null; grade: string | null } {
  const s = raw.trim();
  if (!s) return { school: null, grade: null };
  const m = s.match(/^(.*?)\s*(\d)\s*(학년)?$/);
  if (m && m[1].trim()) return { school: m[1].trim(), grade: m[2] };
  return { school: s, grade: null };
}

/**
 * 시트의 기간 표기를 날짜 쌍으로.
 * "7월16~8월17일[33일]" / "7월21일~8월17일 [28일]" / "2026-08-18 ~ 2026-09-17"
 * 연도가 없으면 기준일의 연도를 쓰고, 종료가 시작보다 앞서면 다음 해로 본다.
 */
export function parsePeriod(raw: string, today: string): { startDate: string; endDate: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = s.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
  if (iso) return { startDate: iso[1], endDate: iso[2] };
  const ko = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*~\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (!ko) return null;
  const year = Number(today.slice(0, 4));
  const start = new Date(year, Number(ko[1]) - 1, Number(ko[2]));
  let end = new Date(year, Number(ko[3]) - 1, Number(ko[4]));
  if (end < start) end = new Date(year + 1, Number(ko[3]) - 1, Number(ko[4]));
  return { startDate: toDateKey(start), endDate: toDateKey(end) };
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw.trim();
}

export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

export function normalizeBool(raw: string): boolean {
  return /^(o|y|yes|true|1|예|○|◯|v)$/i.test(raw.trim());
}
