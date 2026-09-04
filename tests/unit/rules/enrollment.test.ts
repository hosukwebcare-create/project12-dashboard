import { describe, expect, it } from "vitest";
import { currentEnrollment, daysLeft, isExpiringSoon } from "@/lib/rules/enrollment";

const list = [
  { startDate: "2026-07-16", endDate: "2026-08-17" },
  { startDate: "2026-08-18", endDate: "2026-09-17" },
];

describe("currentEnrollment", () => {
  it("오늘을 포함하는 가장 최근 등록을 고른다", () => {
    expect(currentEnrollment(list, "2026-09-05")).toEqual(list[1]);
  });
  it("종료일 당일도 유효하다", () => {
    expect(currentEnrollment(list, "2026-09-17")).toEqual(list[1]);
  });
  it("모두 만료면 null", () => {
    expect(currentEnrollment(list, "2026-09-18")).toBeNull();
  });
  it("빈 목록이면 null", () => {
    expect(currentEnrollment([], "2026-09-05")).toBeNull();
  });
});

describe("daysLeft", () => {
  it("종료일까지 남은 일수", () => {
    expect(daysLeft({ startDate: "2026-08-18", endDate: "2026-09-12" }, "2026-09-05")).toBe(7);
  });
  it("당일이면 0", () => {
    expect(daysLeft({ startDate: "2026-08-18", endDate: "2026-09-05" }, "2026-09-05")).toBe(0);
  });
});

describe("isExpiringSoon", () => {
  it("7일 이내면 true", () => {
    expect(isExpiringSoon({ startDate: "2026-08-18", endDate: "2026-09-12" }, "2026-09-05")).toBe(true);
  });
  it("8일 남으면 false", () => {
    expect(isExpiringSoon({ startDate: "2026-08-18", endDate: "2026-09-13" }, "2026-09-05")).toBe(false);
  });
  it("등록이 없으면 false", () => {
    expect(isExpiringSoon(null, "2026-09-05")).toBe(false);
  });
});
