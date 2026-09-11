import { beforeEach, describe, expect, it } from "vitest";
import { dashboard } from "@/modules/dashboard/repo";
import { createIssue } from "@/modules/issues/repo";
import { createMember } from "@/modules/members/repo";
import { completeSession, startSession, upsertCheck } from "@/modules/rounding/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

const TODAY = "2026-09-05"; // 토요일, 주 시작 2026-08-31

describe("대시보드", () => {
  beforeEach(resetDb);

  it("회차 진행, 미해결 이슈, 주간 벌점 상위, 상담 미작성, 만료 임박을 모은다", async () => {
    const t = await seedTwoBranches();
    const a = await createMember(t.mgrCtx1, { name: "가", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false, enrollment: { startDate: "2026-08-01", endDate: "2026-09-10", planType: "regular" } });
    const b = await createMember(t.mgrCtx1, { name: "나", status: "enrolled", seatId: t.seats1[1].id, memberKind: "student", focusCare: false, enrollment: { startDate: "2026-08-01", endDate: "2026-10-30", planType: "regular" } });
    const sid = await startSession(t.asstCtx1, TODAY);
    const sleepy = t.rules.find((r) => r.name === "졸음")!;
    const late = t.rules.find((r) => r.name === "지각")!;
    await upsertCheck(t.asstCtx1, { memberId: a, date: TODAY, itemKey: "round", roundNo: 1, sessionId: sid, grade: "p", penaltyRuleId: sleepy.id });
    await upsertCheck(t.asstCtx1, { memberId: b, date: "2026-09-03", itemKey: "attendance", roundNo: 0, grade: "p", penaltyRuleId: late.id });
    await upsertCheck(t.asstCtx1, { memberId: b, date: "2026-08-30", itemKey: "attendance", roundNo: 0, grade: "p", penaltyRuleId: late.id }); // 지난주
    await completeSession(t.asstCtx1, sid);
    await createIssue(t.asstCtx1, { memberId: a, title: "이슈1", body: null, severity: "high", source: "manual" });

    const d = await dashboard(t.mgrCtx1, TODAY);
    expect(d.sessionsDone).toBe(1);
    expect(d.roundsPerDay).toBe(12);
    expect(d.openIssues.map((i) => i.title)).toEqual(["이슈1"]);
    expect(d.topPenalties.map((p) => [p.name, p.points])).toEqual([
      ["나", 4],
      ["가", 3],
    ]);
    expect(d.missingWeekly).toBe(2);
    expect(d.expiring.map((e) => [e.name, e.endDate])).toEqual([["가", "2026-09-10"]]);
    expect(d.recentRounds).toHaveLength(7);
    expect(d.recentRounds[0].date).toBe("2026-08-30");
    expect(d.recentRounds[6]).toEqual({ date: TODAY, done: 1 });
  });

  it("타 지점 데이터는 섞이지 않는다", async () => {
    const t = await seedTwoBranches();
    await createMember(t.mgrCtx2, { name: "타", status: "enrolled", seatId: t.seats2[0].id, memberKind: "student", focusCare: false });
    const d = await dashboard(t.mgrCtx1, TODAY);
    expect(d.missingWeekly).toBe(0);
    expect(d.topPenalties).toEqual([]);
  });
});

describe("본사 전 지점 요약", () => {
  beforeEach(resetDb);

  it("지점별 등록 회원·오늘 회차·미해결 이슈·상담 미작성을 모은다", async () => {
    const t = await seedTwoBranches();
    const { hqOverview } = await import("@/modules/dashboard/repo");
    await createMember(t.mgrCtx1, { name: "가", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false });
    await createMember(t.mgrCtx2, { name: "나", status: "enrolled", seatId: t.seats2[0].id, memberKind: "student", focusCare: false });
    await createMember(t.mgrCtx2, { name: "다", status: "prospect", memberKind: "student", focusCare: false });
    await createIssue(t.asstCtx1, { memberId: null, title: "x", body: null, severity: "low", source: "manual" });
    const rows = await hqOverview(t.hqCtx1, TODAY);
    expect(rows.map((r) => [r.branchName, r.enrolled, r.openIssues, r.missingWeekly])).toEqual([
      ["지점1", 1, 1, 1],
      ["지점2", 1, 0, 1],
    ]);
    await expect(hqOverview(t.mgrCtx1, TODAY)).rejects.toThrow();
  });
});
