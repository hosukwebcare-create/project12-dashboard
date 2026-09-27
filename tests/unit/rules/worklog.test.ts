import { describe, expect, it } from "vitest";
import { computeHoursX100, elapsedToHoursX100, EMPLOYMENT_TYPES, employmentLabel, formatDuration, formatHours, minutesToHoursX100, parseHoursToX100, parseMinutes, SHEET_SLOT_PRESET, SLOT_AUDIENCES, slotsForAudience, STAFF_GROUPS, staffGroupOf } from "@/lib/rules/worklog";

const slots = [
  { key: "t1", hoursX100: 50, minutes: null, weekend: false },
  { key: "t2", hoursX100: 100, minutes: null, weekend: false },
  { key: "w1", hoursX100: 150, minutes: null, weekend: true },
];

/** 시트의 주간조교 타임: 1타임 60분, 2~7타임 15분씩 */
const sheetSlots = SHEET_SLOT_PRESET.filter((p) => p.audience === "주간조교").map((p) => ({ key: p.key, hoursX100: 0, minutes: p.minutes, weekend: p.sunday }));

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

  it("시트처럼 분을 먼저 다 더한 뒤 시간으로 바꾼다", () => {
    // 평일을 다 체크한 주간조교: 60 + 15×6 = 150분 = 2.5시간
    expect(computeHoursX100(sheetSlots, ["d1", "d2", "d3", "d4", "d5", "d6", "d7"])).toBe(250);
    // 10분짜리 셋을 따로 반올림하면 0.51 이 된다. 시트는 30분을 한 번에 나눠 0.5 다
    const tens = ["x1", "x2", "x3"].map((key) => ({ key, hoursX100: 0, minutes: 10, weekend: false }));
    expect(computeHoursX100(tens, ["x1", "x2", "x3"])).toBe(50);
    expect(minutesToHoursX100(10) * 3).toBe(51);
  });

  it("분이 없는 예전 타임과 섞여 있어도 더해진다", () => {
    expect(computeHoursX100([...slots, ...sheetSlots], ["t2", "d1"])).toBe(200);
  });
});

describe("시트 타임표", () => {
  it("근무 형태마다 하루를 다 채운 인정 시간이 시트와 같다", () => {
    const full = (audience: string, sunday: boolean) => {
      const list = SHEET_SLOT_PRESET.filter((p) => p.audience === audience && p.sunday === sunday);
      return computeHoursX100(list.map((p) => ({ key: p.key, hoursX100: 0, minutes: p.minutes, weekend: p.sunday })), list.map((p) => p.key));
    };
    expect(full("주간조교", false)).toBe(250); // 2.5시간
    expect(full("컨설팅", false)).toBe(400); // 4시간
    expect(full("원장", false)).toBe(600); // 6시간
    expect(full("주간조교", true)).toBe(100); // 일1 + 일2 = 1시간
  });

  it("야간조교는 없어졌고, 청소조교는 시트에 수식이 없어 지점이 직접 만든다", () => {
    expect(SHEET_SLOT_PRESET.some((p) => p.audience === "야간조교")).toBe(false);
    expect(SHEET_SLOT_PRESET.some((p) => p.audience === "청소조교")).toBe(false);
    expect(SLOT_AUDIENCES).toEqual(["청소조교", "주간조교", "원장", "컨설팅"]);
    expect(EMPLOYMENT_TYPES).not.toContain("야간조교");
  });

  it("시각이 적힌 타임은 근무시간표에 있는 원장 하나뿐이다", () => {
    expect(SHEET_SLOT_PRESET.filter((p) => p.startTime !== "").map((p) => [p.audience, p.startTime, p.endTime])).toEqual([["원장", "16:00", "23:00"]]);
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
  it("인정 시간은 분 단위 정수로 받는다", () => {
    expect(parseMinutes("15")).toBe(15);
    expect(parseMinutes("")).toBe(0);
    expect(parseMinutes("1.5")).toBeNull();
    expect(parseMinutes("-1")).toBeNull();
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
    // 청소조교는 계정이 조교여도 따로 묶는다
    expect(staffGroupOf("assistant", "청소조교")).toBe("cleaner");
  });

  it("직군은 현장에서 부르는 대로 청소조교 · 조교 · 원장 · 학습멘토", () => {
    expect(STAFF_GROUPS.map((g) => g.label)).toEqual(["청소조교", "조교", "원장", "학습멘토"]);
    expect(employmentLabel("컨설팅")).toBe("컨설팅(학습멘토)");
    expect(employmentLabel("주간조교")).toBe("주간조교");
  });

  it("내 근무 형태 타임과 공통 타임만, 평일/일요일에 맞춰 고른다", () => {
    const slots = [
      { key: "d1", weekend: false, audience: "주간조교" as const },
      { key: "n1", weekend: false, audience: "청소조교" as const },
      { key: "c1", weekend: false, audience: "컨설팅" as const },
      { key: "t1", weekend: false, audience: null },
      { key: "dsun1", weekend: true, audience: "주간조교" as const },
    ];
    // 근무 형태마다 타임표가 다르다
    expect(slotsForAudience(slots, "주간조교", false).map((s) => s.key)).toEqual(["d1", "t1"]);
    expect(slotsForAudience(slots, "청소조교", false).map((s) => s.key)).toEqual(["n1", "t1"]);
    expect(slotsForAudience(slots, "컨설팅", false).map((s) => s.key)).toEqual(["c1", "t1"]);
    expect(slotsForAudience(slots, "주간조교", true).map((s) => s.key)).toEqual(["dsun1"]);
  });
});
