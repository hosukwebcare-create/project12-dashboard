import { describe, expect, it } from "vitest";
import { computeHoursX100, elapsedToHoursX100, formatDuration, formatHours, parseHoursToX100 } from "@/lib/rules/worklog";

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

describe("출퇴근 시계", () => {
  const at = (h: number, m = 0, s = 0) => new Date(2026, 8, 10, h, m, s).getTime();

  it("출근에서 퇴근까지를 인정 시간으로 바꾼다", () => {
    expect(elapsedToHoursX100(at(9), at(18))).toBe(900);
    expect(elapsedToHoursX100(at(9, 3), at(18, 12))).toBe(915); // 9시간 9분 → 9.15
    expect(elapsedToHoursX100(at(9), at(9, 30))).toBe(50);
  });

  it("퇴근이 출근보다 앞서면 0으로 둔다 (시계를 되돌려도 음수 근무가 생기지 않게)", () => {
    expect(elapsedToHoursX100(at(18), at(9))).toBe(0);
  });

  it("경과 시간을 시:분:초로 보여 준다", () => {
    expect(formatDuration(0)).toBe("0:00:00");
    expect(formatDuration(3_600_000)).toBe("1:00:00");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
    expect(formatDuration(-5000)).toBe("0:00:00");
  });
});
