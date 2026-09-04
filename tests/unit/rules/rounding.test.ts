import { describe, expect, it } from "vitest";
import { nextRoundNo } from "@/lib/rules/rounding";

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
