import { describe, expect, it } from "vitest";
import { AUTO_ATTENDANCE_NOTE, autoAttendanceCell, canFillRest, carryForwardGrade, cellKey, dayColumns, deriveAttendance, escalateSleepy, isAutoAttendance, nextRoundNo } from "@/lib/rules/rounding";

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
    expect(isAutoAttendance({ note: AUTO_ATTENDANCE_NOTE })).toBe(true);
    expect(isAutoAttendance({ note: "R3 라운딩에서 확인", grade: "a", points: 0 })).toBe(true);
    expect(isAutoAttendance({ note: null })).toBe(false);
    expect(isAutoAttendance({ note: "10:40 등원" })).toBe(false);
  });
  it("예전 메모('R3 라운딩에서 확인')가 남아 있어도 사람이 고쳐 둔 줄(지각·b·등원 시각·CALL)은 사람이 적은 것", () => {
    expect(isAutoAttendance({ note: "R3 라운딩에서 확인", grade: "p", points: 4 })).toBe(false);
    expect(isAutoAttendance({ note: "R3 라운딩에서 확인", grade: "b" })).toBe(false);
    expect(isAutoAttendance({ note: "R3 라운딩에서 확인", grade: "a", arrivalTime: "10:40" })).toBe(false);
    expect(isAutoAttendance({ note: "R3 라운딩에서 확인", grade: "a", called: true })).toBe(false);
  });
  it("자동 출석 칸은 서버와 화면이 같은 모양", () => {
    expect(autoAttendanceCell("b")).toEqual({ grade: "b", points: 0, penaltyRuleId: null, note: AUTO_ATTENDANCE_NOTE, isIssue: false, auto: true });
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
  it("라운딩 항목의 키가 무엇이든 회차 칸은 round 로 쌓고, 라운딩 항목이 둘이어도 한 번만 펼친다", () => {
    const cols = dayColumns([{ key: "rounding", label: "라운딩", kind: "round" }, { key: "vocab", label: "영단어", kind: "daily" }, { key: "r2", label: "라운딩2", kind: "round" }], 2);
    expect(cols.map((c) => [c.itemKey, c.label])).toEqual([
      ["round", "R1"],
      ["round", "R2"],
      ["vocab", "영단어"],
    ]);
  });
  it("라운딩 항목이 없는 지점도 회차 열은 맨 뒤에 붙는다", () => {
    const cols = dayColumns([{ key: "planner", label: "플래너", kind: "daily" }], 2);
    expect(cols.map((c) => c.label)).toEqual(["플래너", "R1", "R2"]);
  });
});

describe("연속 졸음", () => {
  const rules = [
    { id: "sleep", name: "졸음" },
    { id: "sleep2", name: "연속 졸음" },
    { id: "late", name: "지각" },
  ];
  it("같은 날 앞 회차에 졸음이 있으면 졸음 펜도 연속 졸음으로 적는다", () => {
    expect(escalateSleepy(rules, "sleep", ["late", "sleep"])).toBe("sleep2");
    expect(escalateSleepy(rules, "sleep", ["sleep2"])).toBe("sleep2");
  });
  it("앞 회차에 졸음이 없거나 졸음이 아닌 규칙이면 고른 그대로", () => {
    expect(escalateSleepy(rules, "sleep", ["late", null])).toBe("sleep");
    expect(escalateSleepy(rules, "late", ["sleep"])).toBe("late");
    expect(escalateSleepy(rules, "sleep2", ["sleep"])).toBe("sleep2");
  });
  it("연속 졸음 규칙이 없는 지점은 졸음 그대로", () => {
    expect(escalateSleepy([{ id: "sleep", name: "졸음" }], "sleep", ["sleep"])).toBe("sleep");
  });
});
