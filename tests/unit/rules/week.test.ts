import { describe, expect, it } from "vitest";
import { toDateKey, weekDays, weekStart, weeksInMonth, addDays } from "@/lib/rules/week";

describe("weekStart", () => {
  it("토요일 2026-09-05의 주 시작은 월요일 2026-08-31", () => {
    expect(toDateKey(weekStart(new Date(2026, 8, 5)))).toBe("2026-08-31");
  });
  it("일요일은 직전 월요일", () => {
    expect(toDateKey(weekStart(new Date(2026, 8, 6)))).toBe("2026-08-31");
  });
  it("월요일은 그대로", () => {
    expect(toDateKey(weekStart(new Date(2026, 8, 7)))).toBe("2026-09-07");
  });
  it("시각은 00:00으로 정규화", () => {
    const d = weekStart(new Date(2026, 8, 5, 15, 30));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
  it("문자열 날짜 키도 받는다", () => {
    expect(toDateKey(weekStart("2026-09-05"))).toBe("2026-08-31");
  });
});

describe("weekDays", () => {
  it("월요일부터 7일을 돌려준다", () => {
    expect(weekDays("2026-08-31").map(toDateKey)).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });
});

describe("weeksInMonth", () => {
  it("2026년 9월에 시작하는 주는 7, 14, 21, 28일", () => {
    expect(weeksInMonth(2026, 9).map(toDateKey)).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
  });
  it("2026년 6월은 1일이 월요일이라 5주", () => {
    expect(weeksInMonth(2026, 6).map(toDateKey)).toEqual([
      "2026-06-01",
      "2026-06-08",
      "2026-06-15",
      "2026-06-22",
      "2026-06-29",
    ]);
  });
});

describe("addDays / toDateKey", () => {
  it("월말을 넘긴다", () => {
    expect(toDateKey(addDays("2026-08-31", 1))).toBe("2026-09-01");
  });
  it("한 자리 월·일은 0으로 채운다", () => {
    expect(toDateKey(new Date(2026, 0, 3))).toBe("2026-01-03");
  });
});
