import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { applyGroupSlotPreset, clockIn, clockOut, confirmWorkLog, dailyWorkLogs, listShiftSlots, monthlySummary, myStaffGroup, myWorkClock, myWorkLog, saveWorkLog, upsertShiftSlot, upsertStaffProfile } from "@/modules/worklog/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

async function seedSlots() {
  const t = await seedTwoBranches();
  await upsertShiftSlot(t.mgrCtx1, { key: "t1", label: "1타임", startTime: "09:00", endTime: "09:30", hoursX100: 50, weekend: false, sort: 1, active: true });
  await upsertShiftSlot(t.mgrCtx1, { key: "t2", label: "2타임", startTime: "09:30", endTime: "10:30", hoursX100: 100, weekend: false, sort: 2, active: true });
  await upsertShiftSlot(t.mgrCtx1, { key: "w1", label: "일1타임", startTime: "10:00", endTime: "13:00", hoursX100: 300, weekend: true, sort: 3, active: true });
  await upsertStaffProfile(t.mgrCtx1, { userId: t.users.asst1.id, employmentType: "주간조교", hourlyRate: 10000, workDays: "월~수", direct: true });
  return t;
}

describe("근무 타임 설정", () => {
  beforeEach(resetDb);

  it("지점장만 타임을 만들고, 키는 지점 안에서 유일하다", async () => {
    const t = await seedSlots();
    expect((await listShiftSlots(t.asstCtx1)).map((s) => s.key)).toEqual(["t1", "t2", "w1"]);
    expect(await listShiftSlots(t.mgrCtx2)).toEqual([]);
    await expect(upsertShiftSlot(t.asstCtx1, { key: "x", label: "x", startTime: "09:00", endTime: "10:00", hoursX100: 100, weekend: false, sort: 9, active: true })).rejects.toThrow(ForbiddenError);
    await expect(upsertShiftSlot(t.mgrCtx1, { key: "t1", label: "중복", startTime: "09:00", endTime: "10:00", hoursX100: 100, weekend: false, sort: 9, active: true })).rejects.toThrow(ValidationError);
  });
});

describe("직군별 타임", () => {
  beforeEach(resetDb);

  it("기본 타임을 넣으면 세 직군 타임이 생기고 평일 공통 타임은 쉬게 된다. 지난 기록의 시간은 그대로다", async () => {
    const t = await seedSlots();
    await saveWorkLog(t.asstCtx1, { date: "2026-09-03", slotKeys: ["t1", "t2"], overtimeX100: 0, overtimeReason: null, note: null });
    await expect(applyGroupSlotPreset(t.asstCtx1)).rejects.toThrow(ForbiddenError);

    expect(await applyGroupSlotPreset(t.mgrCtx1)).toEqual({ added: 3, retired: 2 });
    const active = await listShiftSlots(t.mgrCtx1);
    expect(active.map((s) => [s.key, s.audience, s.hours])).toEqual([
      ["w1", null, 300],
      ["asst", "assistant", 717],
      ["mgr", "manager", 700],
      ["mentor", "mentor", 400],
    ]);
    // 다시 눌러도 같다
    expect(await applyGroupSlotPreset(t.mgrCtx1)).toEqual({ added: 0, retired: 0 });
    // 다른 지점은 건드리지 않는다
    expect(await listShiftSlots(t.mgrCtx2)).toEqual([]);

    // 쉬게 된 타임으로 적어 둔 지난 근무를 메모만 고쳐 다시 저장해도 시간이 사라지지 않는다
    await saveWorkLog(t.asstCtx1, { date: "2026-09-03", slotKeys: ["t1", "t2"], overtimeX100: 0, overtimeReason: null, note: "메모 추가" });
    expect(await myWorkLog(t.asstCtx1, "2026-09-03")).toMatchObject({ hoursX100: 150, note: "메모 추가" });

    // 조교는 조교 타임으로 저장한다
    await saveWorkLog(t.asstCtx1, { date: "2026-09-04", slotKeys: ["asst"], overtimeX100: 0, overtimeReason: null, note: null });
    expect(await myWorkLog(t.asstCtx1, "2026-09-04")).toMatchObject({ hoursX100: 717 });
  });

  it("직군은 근무 형태가 있으면 그것으로, 없으면 계정 역할로 정한다", async () => {
    const t = await seedSlots();
    expect(await myStaffGroup(t.asstCtx1)).toBe("assistant");
    expect(await myStaffGroup(t.mentorCtx1)).toBe("mentor");
    expect(await myStaffGroup(t.mgrCtx1)).toBe("manager");
    await upsertStaffProfile(t.mgrCtx1, { userId: t.users.mentor1.id, employmentType: "원장", hourlyRate: null, workDays: null, direct: true });
    expect(await myStaffGroup(t.mentorCtx1)).toBe("manager");
    await saveWorkLog(t.mentorCtx1, { date: "2026-09-03", slotKeys: ["t1"], overtimeX100: 0, overtimeReason: null, note: null });
    expect((await dailyWorkLogs(t.mgrCtx1, "2026-09-03")).map((d) => [d.userName, d.group])).toEqual([["멘토1", "manager"]]);
  });
});

describe("근무일지", () => {
  beforeEach(resetDb);

  it("조교가 자기 근무를 저장하면 시간이 계산되고, 초과근무는 사유가 필요하다", async () => {
    const t = await seedSlots();
    await saveWorkLog(t.asstCtx1, { date: "2026-09-03", slotKeys: ["t1", "t2"], overtimeX100: 0, overtimeReason: null, note: null });
    const mine = await myWorkLog(t.asstCtx1, "2026-09-03");
    expect(mine).toMatchObject({ slotKeys: ["t1", "t2"], hoursX100: 150, overtimeX100: 0 });
    await expect(saveWorkLog(t.asstCtx1, { date: "2026-09-03", slotKeys: ["t1"], overtimeX100: 81, overtimeReason: "", note: null })).rejects.toThrow(/사유/);
    await saveWorkLog(t.asstCtx1, { date: "2026-09-03", slotKeys: ["t1"], overtimeX100: 81, overtimeReason: "외출 확인, 남자 화장실 정리", note: null });
    expect(await myWorkLog(t.asstCtx1, "2026-09-03")).toMatchObject({ hoursX100: 50, overtimeX100: 81 });
  });

  it("지점장은 다른 직원의 근무를 대신 입력하고 일별 현황을 본다", async () => {
    const t = await seedSlots();
    await saveWorkLog(t.mgrCtx1, { userId: t.users.asst1.id, date: "2026-09-03", slotKeys: ["t2"], overtimeX100: 0, overtimeReason: null, note: "대리 입력" });
    await saveWorkLog(t.mentorCtx1, { date: "2026-09-03", slotKeys: ["t1"], overtimeX100: 0, overtimeReason: null, note: null });
    const day = await dailyWorkLogs(t.mgrCtx1, "2026-09-03");
    expect(day.map((d) => [d.userName, d.hoursX100])).toEqual([
      ["멘토1", 50],
      ["조교1", 100],
    ]);
    // 조교는 남의 근무를 입력할 수 없다
    await expect(saveWorkLog(t.asstCtx1, { userId: t.users.mentor1.id, date: "2026-09-03", slotKeys: ["t1"], overtimeX100: 0, overtimeReason: null, note: null })).rejects.toThrow(ForbiddenError);
  });

  it("본사 확인 후에는 잠기고, 월 집계에 확인 시간·예상 급여가 나온다", async () => {
    const t = await seedSlots();
    const id = await saveWorkLog(t.asstCtx1, { date: "2026-09-03", slotKeys: ["t1", "t2"], overtimeX100: 50, overtimeReason: "마감 정리", note: null });
    await saveWorkLog(t.asstCtx1, { date: "2026-09-04", slotKeys: ["t2"], overtimeX100: 0, overtimeReason: null, note: null });
    await expect(confirmWorkLog(t.mgrCtx1, id)).rejects.toThrow(ForbiddenError);
    await confirmWorkLog(t.hqCtx1, id);
    await expect(saveWorkLog(t.asstCtx1, { date: "2026-09-03", slotKeys: ["t1"], overtimeX100: 0, overtimeReason: null, note: null })).rejects.toThrow(/확인/);
    const sum = await monthlySummary(t.mgrCtx1, "2026-09");
    const row = sum.find((r) => r.userId === t.users.asst1.id)!;
    expect(row).toMatchObject({ userName: "조교1", employmentType: "주간조교", days: 2, hoursX100: 250, overtimeX100: 50, confirmedX100: 200, hourlyRate: 10000, estimatedPay: 30000 });
    await expect(monthlySummary(t.asstCtx1, "2026-09")).rejects.toThrow(ForbiddenError);
  });
});

describe("출퇴근 시계", () => {
  beforeEach(resetDb);

  const D = "2026-09-10";
  const at = (h: number, m = 0) => new Date(`${D}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`);

  it("출근하면 시작 시각이 남고, 퇴근하면 그 사이가 인정 시간이 된다", async () => {
    const t = await seedSlots();

    let s = (await myWorkClock(t.asstCtx1, D))!;
    expect(s).toMatchObject({ clockInAt: null, clockOutAt: null, hoursX100: 0 });
    expect(s.targetHoursX100).toBe(800); // 설정 전에는 8시간

    await clockIn(t.asstCtx1, D, at(9, 3));
    s = (await myWorkClock(t.asstCtx1, D))!;
    expect(s.clockInAt).toBe(at(9, 3).toISOString());
    expect(s.clockOutAt).toBeNull();

    await clockOut(t.asstCtx1, D, at(18, 12));
    s = (await myWorkClock(t.asstCtx1, D))!;
    expect(s.clockOutAt).toBe(at(18, 12).toISOString());
    expect(s.hoursX100).toBe(915); // 9시간 9분
  });

  it("두 번 눌러도 시작 시각이 밀리지 않고, 퇴근을 두 번 눌러도 시간이 늘지 않는다", async () => {
    const t = await seedSlots();
    await clockIn(t.asstCtx1, D, at(9));
    await clockIn(t.asstCtx1, D, at(11));
    expect((await myWorkClock(t.asstCtx1, D))!.clockInAt).toBe(at(9).toISOString());

    await clockOut(t.asstCtx1, D, at(17));
    await clockOut(t.asstCtx1, D, at(19));
    expect((await myWorkClock(t.asstCtx1, D))!.hoursX100).toBe(800);
  });

  it("실수로 퇴근을 눌렀다면 다시 출근해도 처음 출근 시각이 남는다", async () => {
    const t = await seedSlots();
    await clockIn(t.asstCtx1, D, at(9));
    await clockOut(t.asstCtx1, D, at(12));
    await clockIn(t.asstCtx1, D, at(12, 1));
    const s = (await myWorkClock(t.asstCtx1, D))!;
    expect(s.clockInAt).toBe(at(9).toISOString());
    expect(s.clockOutAt).toBeNull();
    await clockOut(t.asstCtx1, D, at(18));
    expect((await myWorkClock(t.asstCtx1, D))!.hoursX100).toBe(900);
  });

  it("출근하지 않고 퇴근할 수 없다", async () => {
    const t = await seedTwoBranches();
    await expect(clockOut(t.asstCtx1, D, at(18))).rejects.toThrow(/출근을 먼저/);
  });

  it("출퇴근으로 잰 시간은 타임 체크를 고쳐도 그대로다", async () => {
    const t = await seedSlots();
    await clockIn(t.asstCtx1, D, at(9));
    await clockOut(t.asstCtx1, D, at(18));
    // 어느 타임을 맡았는지는 따로 남기되, 잰 시간은 바뀌지 않는다
    await saveWorkLog(t.asstCtx1, { date: D, slotKeys: ["t1"], overtimeX100: 0, overtimeReason: null, note: null });
    const s = (await myWorkClock(t.asstCtx1, D))!;
    expect(s.hoursX100).toBe(900);
    expect((await myWorkLog(t.asstCtx1, D))!.slotKeys).toEqual(["t1"]);
  });

  it("본사 확인이 끝난 날은 출퇴근을 고칠 수 없다", async () => {
    const t = await seedSlots();
    await clockIn(t.asstCtx1, D, at(9));
    await clockOut(t.asstCtx1, D, at(18));
    const [row] = await dailyWorkLogs(t.mgrCtx1, D);
    await confirmWorkLog(t.hqCtx1, row.id);
    await expect(clockIn(t.asstCtx1, D, at(19))).rejects.toThrow(/본사 확인/);
    expect((await myWorkClock(t.asstCtx1, D))!.locked).toBe(true);
  });

  it("이번 주 누적·연장·목표를 함께 준다", async () => {
    const t = await seedSlots();
    // 지난 이틀치 기록 (같은 주)
    const monday = "2026-09-07";
    await clockIn(t.asstCtx1, monday, new Date(`${monday}T09:00:00+09:00`));
    await clockOut(t.asstCtx1, monday, new Date(`${monday}T14:00:00+09:00`));
    await saveWorkLog(t.asstCtx1, { date: "2026-09-08", slotKeys: ["t2"], overtimeX100: 50, overtimeReason: "정리", note: null });

    const s = (await myWorkClock(t.asstCtx1, "2026-09-10"))!;
    expect(s.week).toMatchObject({ startDate: monday, endDate: "2026-09-13", workedX100: 600, overtimeX100: 50 });
    expect(s.week.targetX100).toBe(4000); // 하루 8시간 × 5
    expect(s.userName).toBeTruthy();
    expect(s.employmentType).toBe("주간조교");
  });

  it("주 소정근로시간을 따로 정하면 그 값이 기준이 된다", async () => {
    const t = await seedTwoBranches();
    await upsertStaffProfile(t.mgrCtx1, { userId: t.users.asst1.id, employmentType: "주간조교", hourlyRate: null, workDays: null, direct: true, targetHoursX100: 500, weeklyTargetHoursX100: 2000 });
    const s = (await myWorkClock(t.asstCtx1, D))!;
    expect(s.targetHoursX100).toBe(500);
    expect(s.week.targetX100).toBe(2000);
    await expect(
      upsertStaffProfile(t.mgrCtx1, { userId: t.users.asst1.id, employmentType: "주간조교", hourlyRate: null, workDays: null, direct: true, weeklyTargetHoursX100: 20000 }),
    ).rejects.toThrow(/0~168시간/);
  });

  it("지점에 소속되지 않은 본사 관리자는 출퇴근 카드를 받지 않는다", async () => {
    const t = await seedTwoBranches();
    expect(await myWorkClock(t.hqCtx1, D)).toBeNull();
    await expect(clockIn(t.hqCtx1, D)).rejects.toThrow(/지점 소속/);
  });

  it("지점장이 정한 하루 근무 예정 시간이 게이지 목표가 된다", async () => {
    const t = await seedTwoBranches();
    await upsertStaffProfile(t.mgrCtx1, { userId: t.users.asst1.id, employmentType: "주간조교", hourlyRate: null, workDays: null, direct: true, targetHoursX100: 450 });
    expect((await myWorkClock(t.asstCtx1, D))!.targetHoursX100).toBe(450);
    await expect(
      upsertStaffProfile(t.mgrCtx1, { userId: t.users.asst1.id, employmentType: "주간조교", hourlyRate: null, workDays: null, direct: true, targetHoursX100: 3000 }),
    ).rejects.toThrow(/0~24시간/);
  });
});
