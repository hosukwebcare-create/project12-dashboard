import { describe, expect, it } from "vitest";
import { computeHoursX100, elapsedToHoursX100, formatDuration, formatHours, GROUP_SLOT_PRESET, parseHoursToX100, slotsForGroup, spanToHoursX100, staffGroupOf } from "@/lib/rules/worklog";

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

describe("직군별 타임", () => {
  it("근무 형태가 계정 역할보다 우선한다", () => {
    expect(staffGroupOf("assistant", null)).toBe("assistant");
    expect(staffGroupOf("mentor", undefined)).toBe("mentor");
    expect(staffGroupOf("branch_manager", null)).toBe("manager");
    expect(staffGroupOf("hq_admin", null)).toBe("manager");
    // 계정은 조교인데 원장 일을 하는 직원
    expect(staffGroupOf("assistant", "원장")).toBe("manager");
    expect(staffGroupOf("branch_manager", "야간조교")).toBe("assistant");
    // '기타'는 아무것도 말해 주지 않으므로 역할로 본다
    expect(staffGroupOf("mentor", "기타")).toBe("mentor");
  });

  it("내 직군 타임과 공통 타임만, 평일/주말에 맞춰 고른다", () => {
    const slots = [
      { key: "asst", weekend: false, audience: "assistant" as const },
      { key: "mgr", weekend: false, audience: "manager" as const },
      { key: "mentor", weekend: false, audience: "mentor" as const },
      { key: "t1", weekend: false, audience: null },
      { key: "w1", weekend: true, audience: null },
    ];
    expect(slotsForGroup(slots, "assistant", false).map((s) => s.key)).toEqual(["asst", "t1"]);
    expect(slotsForGroup(slots, "mentor", false).map((s) => s.key)).toEqual(["mentor", "t1"]);
    expect(slotsForGroup(slots, "manager", true).map((s) => s.key)).toEqual(["w1"]);
  });

  it("기본 타임의 인정 시간은 시작~끝 길이다", () => {
    expect(spanToHoursX100("07:50", "15:00")).toBe(717);
    expect(spanToHoursX100("16:00", "23:00")).toBe(700);
    expect(spanToHoursX100("19:00", "23:00")).toBe(400);
    expect(spanToHoursX100("22:00", "01:00")).toBe(300);
    expect(GROUP_SLOT_PRESET.map((p) => p.audience)).toEqual(["assistant", "manager", "mentor"]);
  });
});
