export type SlotSpec = { key: string; hoursX100: number; weekend: boolean };

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
