import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { confirmWorkLog, dailyWorkLogs, listShiftSlots, monthlySummary, myWorkLog, saveWorkLog, upsertShiftSlot, upsertStaffProfile } from "@/modules/worklog/repo";
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
