import { describe, expect, it } from "vitest";
import { isMealAvailable, isOrderLocked, mealDeadline, monthDates, type MealPolicy } from "@/lib/rules/meals";

const policy: MealPolicy = { cutoffTime: "23:59", saturdayLunchOnly: true, sundayClosed: true, closedDates: ["2026-09-15"] };

describe("isMealAvailable", () => {
  it("평일은 중·석식 모두", () => {
    expect(isMealAvailable("2026-09-03", "lunch", policy)).toBe(true);
    expect(isMealAvailable("2026-09-03", "dinner", policy)).toBe(true);
  });
  it("토요일은 중식만", () => {
    expect(isMealAvailable("2026-09-05", "lunch", policy)).toBe(true);
    expect(isMealAvailable("2026-09-05", "dinner", policy)).toBe(false);
  });
  it("일요일은 불가", () => {
    expect(isMealAvailable("2026-09-06", "lunch", policy)).toBe(false);
  });
  it("휴무일은 불가", () => {
    expect(isMealAvailable("2026-09-15", "lunch", policy)).toBe(false);
  });
  it("정책을 끄면 토·일도 가능", () => {
    const open = { ...policy, saturdayLunchOnly: false, sundayClosed: false };
    expect(isMealAvailable("2026-09-05", "dinner", open)).toBe(true);
    expect(isMealAvailable("2026-09-06", "lunch", open)).toBe(true);
  });
});

describe("mealDeadline / isOrderLocked", () => {
  it("마감은 전일 마감 시각", () => {
    expect(mealDeadline("2026-09-05", "23:59").toISOString()).toBe(new Date(2026, 8, 4, 23, 59).toISOString());
    expect(mealDeadline("2026-09-05", "18:00").toISOString()).toBe(new Date(2026, 8, 4, 18, 0).toISOString());
  });
  it("마감 전이면 열려 있고 마감 후면 잠긴다", () => {
    expect(isOrderLocked("2026-09-05", "23:59", new Date(2026, 8, 4, 23, 58))).toBe(false);
    expect(isOrderLocked("2026-09-05", "23:59", new Date(2026, 8, 4, 23, 59))).toBe(true);
    expect(isOrderLocked("2026-09-05", "23:59", new Date(2026, 8, 5, 9, 0))).toBe(true);
    expect(isOrderLocked("2026-09-20", "23:59", new Date(2026, 8, 5, 9, 0))).toBe(false);
  });
});

describe("monthDates", () => {
  it("해당 월의 모든 날짜 키", () => {
    const d = monthDates("2026-09");
    expect(d).toHaveLength(30);
    expect(d[0]).toBe("2026-09-01");
    expect(d[29]).toBe("2026-09-30");
    expect(monthDates("2026-02")).toHaveLength(28);
  });
});
