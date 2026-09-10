const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** 'YYYY-MM-DD' → 'M/D(요일)' */
export function fmtShortDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${m}/${d}(${DOW[date.getDay()]})`;
}

/** 'YYYY-MM-DD' → 'YYYY.MM.DD' */
export function fmtDate(key: string | null | undefined): string {
  if (!key) return "-";
  return key.replaceAll("-", ".");
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "-";
  const x = typeof d === "string" ? new Date(d) : d;
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  const hh = String(x.getHours()).padStart(2, "0");
  const mi = String(x.getMinutes()).padStart(2, "0");
  return `${x.getFullYear()}.${mm}.${dd} ${hh}:${mi}`;
}

/** 시각만. 서버 시간대(Asia/Seoul)를 그대로 쓴다 */
export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "-";
  const x = typeof d === "string" ? new Date(d) : d;
  return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
}

export function fmtRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day}일 전`;
  return fmtDateTime(d);
}
