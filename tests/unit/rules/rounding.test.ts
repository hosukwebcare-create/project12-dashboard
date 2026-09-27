import { describe, expect, it } from "vitest";
import { canFillRest, carryForwardGrade, cellKey, currentRound, dayColumns, deriveAttendance, isAutoAttendance, nextRoundNo } from "@/lib/rules/rounding";

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

describe("출석은 라운딩에서 채운다", () => {
  it("한 번이라도 자리에서 봤으면(a·벌점) a, 온종일 사유로 없었으면 b — 시트 8,831칸 중 87%가 이 규칙", () => {
    expect(deriveAttendance(["b", "b", "a", "a"])).toBe("a");
    expect(deriveAttendance(["b", "p"])).toBe("a");
    expect(deriveAttendance(["b", "b", "b"])).toBe("b");
    expect(deriveAttendance(["na", "b"])).toBe("b");
    expect(deriveAttendance(["na"])).toBe("na");
    expect(deriveAttendance([])).toBeNull();
  });
  it("자동으로 채운 출석만 다시 맞춘다. 사람이 적은 출석(이관한 시트 값 포함)은 그대로", () => {
    expect(isAutoAttendance("라운딩에서 자동")).toBe(true);
    expect(isAutoAttendance("R3 라운딩에서 확인")).toBe(true);
    expect(isAutoAttendance(null)).toBe(false);
    expect(isAutoAttendance("10:40 등원")).toBe(false);
  });
  it("출석과 라운딩은 한꺼번에 채울 수 없다", () => {
    expect(canFillRest("planner")).toBe(true);
    expect(canFillRest("attendance")).toBe(false);
    expect(canFillRest("round")).toBe(false);
  });
});

describe("직전 회차 가져오기", () => {
  it("a·b·부재는 그대로, 벌점은 그 순간의 일이라 a 로", () => {
    expect((["a", "b", "na", "p"] as const).map(carryForwardGrade)).toEqual(["a", "b", "na", "a"]);
  });
});

describe("하루 표의 열", () => {
  const items = [
    { key: "attendance", label: "출석", kind: "daily" as const },
    { key: "planner", label: "플래너", kind: "daily" as const },
    { key: "round", label: "라운딩", kind: "round" as const },
    { key: "vocab", label: "영단어", kind: "daily" as const },
  ];
  it("현황판 순서 그대로, 라운딩은 R1…Rn 으로 펼치고 출석은 자동 열", () => {
    const cols = dayColumns(items, 3, ["09:00", "10:00"]);
    expect(cols.map((c) => [c.label, c.kind, c.time])).toEqual([
      ["출석", "auto", null],
      ["플래너", "daily", null],
      ["R1", "round", "09:00"],
      ["R2", "round", "10:00"],
      ["R3", "round", null],
      ["영단어", "daily", null],
    ]);
    expect(cellKey("m1", "round", 2)).toBe("m1|round|2");
  });
  it("지금 돌 차례는 완료하지 않은 가장 이른 회차", () => {
    expect(currentRound(12, [])).toBe(1);
    expect(currentRound(12, [1, 2, 4])).toBe(3);
    expect(currentRound(3, [1, 2, 3])).toBeNull();
  });
});
