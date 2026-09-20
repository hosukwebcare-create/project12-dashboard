import { describe, expect, it } from "vitest";
import { canFillRest, impliesPresent, nextRoundNo, roundCompanionKeys } from "@/lib/rules/rounding";

describe("nextRoundNo", () => {
  it("아무 회차도 없으면 1", () => {
    expect(nextRoundNo([], 12)).toBe(1);
  });
  it("1,2,3 다음은 4", () => {
    expect(nextRoundNo([1, 2, 3], 12)).toBe(4);
  });
  it("빠진 회차가 있으면 그 회차를 먼저 채운다", () => {
    expect(nextRoundNo([1, 3], 12)).toBe(2);
  });
  it("하루 회차를 모두 썼으면 null", () => {
    expect(nextRoundNo([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 12)).toBeNull();
  });
});

describe("라운딩과 함께 기록할 항목", () => {
  it("설정이 없으면 출석·플래너·영단어, 순서는 지점의 항목 순서", () => {
    expect(roundCompanionKeys(undefined, ["vocab", "checkout", "attendance", "planner"])).toEqual(["vocab", "attendance", "planner"]);
  });
  it("설정한 대로, 지금 없는 항목은 뺀다. 빈 목록은 '함께 기록 안 함'", () => {
    expect(roundCompanionKeys(["checkout", "gone"], ["attendance", "checkout"])).toEqual(["checkout"]);
    expect(roundCompanionKeys([], ["attendance", "planner"])).toEqual([]);
  });
  it("출석과 라운딩은 한꺼번에 채울 수 없다", () => {
    expect(canFillRest("planner")).toBe(true);
    expect(canFillRest("attendance")).toBe(false);
    expect(canFillRest("round")).toBe(false);
  });
  it("부재만 '자리에 없었다'", () => {
    expect(["a", "b", "p", "na"].map(impliesPresent)).toEqual([true, true, true, false]);
  });
});
