/** 아직 만들지 않은 가장 작은 회차. 하루 회차를 모두 썼으면 null */
export function nextRoundNo(existing: number[], roundsPerDay: number): number | null {
  const used = new Set(existing);
  for (let n = 1; n <= roundsPerDay; n++) {
    if (!used.has(n)) return n;
  }
  return null;
}

/** 설정을 건드리지 않은 지점이 라운딩과 함께 기록하는 일별 항목 */
export const DEFAULT_ROUND_COMPANIONS = ["attendance", "planner", "vocab"];

/**
 * 라운딩 화면에 함께 띄울 일별 항목 키. 순서는 지점의 일별 항목 순서를 따르고,
 * 지금 쓰지 않는 항목은 설정에 남아 있어도 빠진다.
 */
export function roundCompanionKeys(configured: string[] | undefined, dailyItemKeys: string[]): string[] {
  const want = new Set(configured ?? DEFAULT_ROUND_COMPANIONS);
  return dailyItemKeys.filter((k) => want.has(k));
}

/**
 * '나머지 전원 a'를 허용하는 항목인가. 출석은 안 된다 —
 * 표시하지 않은 학생을 한꺼번에 '왔다'고 적으면 결석이 출석으로 바뀐다.
 */
export function canFillRest(itemKey: string): boolean {
  return itemKey !== "attendance" && itemKey !== "round";
}

/** 라운딩 등급이 '자리에 있었다'는 뜻인가. 부재만 아니다 */
export function impliesPresent(grade: string): boolean {
  return grade === "a" || grade === "b" || grade === "p";
}
