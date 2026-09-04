/** 아직 만들지 않은 가장 작은 회차. 하루 회차를 모두 썼으면 null */
export function nextRoundNo(existing: number[], roundsPerDay: number): number | null {
  const used = new Set(existing);
  for (let n = 1; n <= roundsPerDay; n++) {
    if (!used.has(n)) return n;
  }
  return null;
}
