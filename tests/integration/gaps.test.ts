import { beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { createIssue, getIssue } from "@/modules/issues/repo";
import { createMember } from "@/modules/members/repo";
import { sheetRows, startSession, upsertCheck } from "@/modules/rounding/repo";
import { upsertCustomFieldDef, upsertUser } from "@/modules/settings/repo";
import { hqWorklogSummary, saveWorkLog, upsertShiftSlot } from "@/modules/worklog/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

describe("이슈 커스텀 필드", () => {
  beforeEach(resetDb);

  it("이슈 정의에 맞춰 값을 검증·저장한다", async () => {
    const t = await seedTwoBranches();
    await upsertCustomFieldDef(t.hqCtx1, { entity: "issue", key: "place", label: "발생 장소", type: "select", options: ["열람실", "휴게실"], required: true, sort: 1, active: true });
    await expect(createIssue(t.asstCtx1, { memberId: null, title: "x", body: null, severity: "normal", source: "manual", custom: { place: "옥상" } })).rejects.toThrow(ValidationError);
    const id = await createIssue(t.asstCtx1, { memberId: null, title: "x", body: null, severity: "normal", source: "manual", custom: { place: "휴게실" } });
    expect((await getIssue(t.mgrCtx1, id)).custom).toEqual({ place: "휴게실" });
    // 라운딩에서 자동 생성되는 이슈는 필수 커스텀 필드가 없어도 만들어진다
    const m = await createMember(t.mgrCtx1, { name: "가", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false });
    const sid = await startSession(t.asstCtx1, "2026-09-05");
    const rule = t.rules.find((r) => r.name === "이동금지 위반")!;
    await expect(upsertCheck(t.asstCtx1, { memberId: m, date: "2026-09-05", itemKey: "round", roundNo: 1, sessionId: sid, grade: "p", penaltyRuleId: rule.id, isIssue: true })).resolves.toBeUndefined();
  });
});

describe("라운딩 시트 · 같은 날 이전 벌점 표시 (연속 졸음 추천)", () => {
  beforeEach(resetDb);

  it("이전 회차의 벌점 규칙 이름을 행에 담아 준다", async () => {
    const t = await seedTwoBranches();
    const m = await createMember(t.mgrCtx1, { name: "가", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false });
    const s1 = await startSession(t.asstCtx1, "2026-09-05");
    const s2 = await startSession(t.asstCtx1, "2026-09-05");
    const sleepy = t.rules.find((r) => r.name === "졸음")!;
    await upsertCheck(t.asstCtx1, { memberId: m, date: "2026-09-05", itemKey: "round", roundNo: 1, sessionId: s1, grade: "p", penaltyRuleId: sleepy.id });
    const rows = await sheetRows(t.asstCtx1, "2026-09-05", "round", 2);
    expect(rows[0].priorPenalties).toEqual(["졸음"]);
    void s2;
    const rows1 = await sheetRows(t.asstCtx1, "2026-09-05", "round", 1);
    expect(rows1[0].priorPenalties).toEqual([]);
  });
});

describe("본사 근무 지점별 집계", () => {
  beforeEach(resetDb);

  it("전 지점의 월 근무시간·초과·예상 급여를 지점별로 모은다", async () => {
    const t = await seedTwoBranches();
    await upsertShiftSlot(t.mgrCtx1, { key: "t1", label: "1타임", startTime: "09:00", endTime: "10:00", hoursX100: 100, weekend: false, sort: 1, active: true });
    await upsertShiftSlot(t.mgrCtx2, { key: "t1", label: "1타임", startTime: "09:00", endTime: "10:00", hoursX100: 100, weekend: false, sort: 1, active: true });
    await saveWorkLog(t.asstCtx1, { date: "2026-09-03", slotKeys: ["t1"], overtimeX100: 50, overtimeReason: "정리", note: null });
    await saveWorkLog(t.mgrCtx2, { date: "2026-09-03", slotKeys: ["t1"], overtimeX100: 0, overtimeReason: null, note: null });
    const rows = await hqWorklogSummary(t.hqCtx1, "2026-09");
    expect(rows.map((r) => [r.branchName, r.staff, r.hoursX100, r.overtimeX100])).toEqual([
      ["지점1", 1, 100, 50],
      ["지점2", 1, 100, 0],
    ]);
    await expect(hqWorklogSummary(t.mgrCtx1, "2026-09")).rejects.toThrow();
  });
});

describe("비밀번호 정책", () => {
  beforeEach(resetDb);

  it("새 비밀번호는 10자 이상, 영문과 숫자를 포함해야 한다", async () => {
    const t = await seedTwoBranches();
    await expect(upsertUser(t.mgrCtx1, { loginId: "newone", name: "x", password: "short1", role: "assistant", active: true })).rejects.toThrow(/10자/);
    await expect(upsertUser(t.mgrCtx1, { loginId: "newone", name: "x", password: "onlyletters", role: "assistant", active: true })).rejects.toThrow(/숫자/);
    await expect(upsertUser(t.mgrCtx1, { loginId: "newone", name: "x", password: "goodpass12", role: "assistant", active: true })).resolves.toBeTruthy();
  });
});
