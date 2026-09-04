import { describe, expect, it } from "vitest";
import { computeHoursX100, formatHours, parseHoursToX100 } from "@/lib/rules/worklog";

const slots = [
  { key: "t1", hoursX100: 50, weekend: false },
  { key: "t2", hoursX100: 100, weekend: false },
  { key: "w1", hoursX100: 150, weekend: true },
];

describe("computeHoursX100", () => {
  it("체크한 타임의 인정 시간을 합친다", () => {
    expect(computeHoursX100(slots, ["t1", "t2"])).toBe(150);
  });
  it("모르는 키는 무시한다", () => {
    expect(computeHoursX100(slots, ["t1", "nope"])).toBe(50);
  });
  it("빈 선택은 0", () => {
    expect(computeHoursX100(slots, [])).toBe(0);
  });
});

describe("시간 표기", () => {
  it("x100 정수를 시간 문자열로", () => {
    expect(formatHours(150)).toBe("1.5");
    expect(formatHours(331)).toBe("3.31");
    expect(formatHours(0)).toBe("0");
  });
  it("입력 문자열을 x100 정수로", () => {
    expect(parseHoursToX100("0.81")).toBe(81);
    expect(parseHoursToX100("2")).toBe(200);
    expect(parseHoursToX100("")).toBe(0);
    expect(parseHoursToX100("abc")).toBeNull();
    expect(parseHoursToX100("-1")).toBeNull();
  });
});
