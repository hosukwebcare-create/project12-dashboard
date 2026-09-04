import { describe, expect, it } from "vitest";
import { pointsFor, sumPoints } from "@/lib/rules/penalty";

describe("sumPoints", () => {
  it("벌점(p) 행의 점수만 합산한다", () => {
    expect(
      sumPoints([
        { grade: "p", points: 3 },
        { grade: "a", points: 0 },
        { grade: "b", points: 0 },
        { grade: "p", points: 8 },
      ]),
    ).toBe(11);
  });
  it("p가 아닌 행에 점수가 있어도 무시한다", () => {
    expect(sumPoints([{ grade: "a", points: 5 }])).toBe(0);
  });
  it("빈 목록은 0", () => {
    expect(sumPoints([])).toBe(0);
  });
});

describe("pointsFor", () => {
  it("p이면 규칙 점수", () => {
    expect(pointsFor("p", 3)).toBe(3);
  });
  it("p인데 규칙이 없으면 0", () => {
    expect(pointsFor("p", null)).toBe(0);
  });
  it("a·b·na는 항상 0", () => {
    expect(pointsFor("a", 5)).toBe(0);
    expect(pointsFor("b", 5)).toBe(0);
    expect(pointsFor("na", 5)).toBe(0);
  });
});
