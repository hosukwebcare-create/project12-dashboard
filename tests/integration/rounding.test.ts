import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { boardItems, checks, issues, roundingSessions } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { createMember } from "@/modules/members/repo";
import { listNotifications } from "@/modules/notifications/repo";
import { completeSession, fillRemaining, roundCompanions, sessionSheet, startSession, todaySessions, upsertCheck } from "@/modules/rounding/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

const DAY = "2026-09-05";

async function seedMembers() {
  const t = await seedTwoBranches();
  const a = await createMember(t.mgrCtx1, { name: "가나다", status: "enrolled", seatId: t.seats1[2].id, memberKind: "student", focusCare: false, fieldNote: "매주 화 학원" });
  const b = await createMember(t.mgrCtx1, { name: "라마바", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false });
  await createMember(t.mgrCtx1, { name: "상담중", status: "prospect", memberKind: "student", focusCare: false });
  const other = await createMember(t.mgrCtx2, { name: "타지점", status: "enrolled", seatId: t.seats2[0].id, memberKind: "student", focusCare: false });
  return { ...t, a, b, other };
}

describe("라운딩 세션", () => {
  beforeEach(resetDb);

  it("회차는 1부터 순서대로 만들어지고 하루 한도를 넘기면 오류", async () => {
    const t = await seedMembers();
    const s1 = await startSession(t.asstCtx1, DAY);
    const s2 = await startSession(t.asstCtx1, DAY);
    const list = await todaySessions(t.asstCtx1, DAY);
    expect(list.map((s) => s.roundNo)).toEqual([1, 2]);
    expect(list.map((s) => s.id)).toEqual([s1, s2]);
    for (let i = 3; i <= 12; i++) await startSession(t.asstCtx1, DAY);
    await expect(startSession(t.asstCtx1, DAY)).rejects.toThrow(/모두 진행/);
  });

  it("회차 시트는 등록 회원만 좌석 순으로, 특이사항과 함께 준다", async () => {
    const t = await seedMembers();
    const sid = await startSession(t.asstCtx1, DAY);
    const sheet = await sessionSheet(t.asstCtx1, sid);
    expect(sheet.session.roundNo).toBe(1);
    expect(sheet.rows.map((r) => [r.seatNo, r.name, r.grade])).toEqual([
      [1, "라마바", null],
      [3, "가나다", null],
    ]);
    expect(sheet.rows[1].fieldNote).toBe("매주 화 학원");
    expect(sheet.rules.map((r) => r.name)).toContain("졸음");
    expect("phone" in sheet.rows[0]).toBe(false);
  });

  it("멘토는 체크를 입력할 수 없다", async () => {
    const t = await seedMembers();
    const sid = await startSession(t.asstCtx1, DAY);
    await expect(upsertCheck(t.mentorCtx1, { memberId: t.a, date: DAY, itemKey: "round", roundNo: 1, sessionId: sid, grade: "a" })).rejects.toThrow(ForbiddenError);
  });

  it("타 지점 회원에는 체크를 입력할 수 없다", async () => {
    const t = await seedMembers();
    await expect(upsertCheck(t.asstCtx1, { memberId: t.other, date: DAY, itemKey: "round", roundNo: 1, grade: "a" })).rejects.toThrow(NotFoundError);
  });
});

describe("체크 입력", () => {
  beforeEach(resetDb);

  it("벌점은 규칙 점수를 스냅샷하고, 다시 입력하면 같은 행이 갱신된다", async () => {
    const t = await seedMembers();
    const sid = await startSession(t.asstCtx1, DAY);
    const sleepy = t.rules.find((r) => r.name === "졸음")!;
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: DAY, itemKey: "round", roundNo: 1, sessionId: sid, grade: "p", penaltyRuleId: sleepy.id, note: "2회차 연속" });
    let rows = await db.select().from(checks).where(eq(checks.memberId, t.a));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ grade: "p", points: 3, seatNoSnapshot: 3, note: "2회차 연속", createdBy: t.users.asst1.id });

    await upsertCheck(t.asstCtx1, { memberId: t.a, date: DAY, itemKey: "round", roundNo: 1, sessionId: sid, grade: "a" });
    rows = await db.select().from(checks).where(eq(checks.memberId, t.a));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ grade: "a", points: 0, penaltyRuleId: null });
  });

  it("이슈로 보고하면 이슈가 만들어지고 지점장에게 알림이 간다", async () => {
    const t = await seedMembers();
    const sid = await startSession(t.asstCtx1, DAY);
    const rule = t.rules.find((r) => r.name === "이동금지 위반")!;
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: DAY, itemKey: "round", roundNo: 1, sessionId: sid, grade: "p", penaltyRuleId: rule.id, isIssue: true, note: "자리 비움" });
    const created = await db.select().from(issues);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ memberId: t.a, source: "rounding", status: "open", reportedBy: t.users.asst1.id });
    expect(created[0].title).toContain("가나다");
    const notis = await listNotifications(t.mgrCtx1);
    expect(notis).toHaveLength(1);
    expect(notis[0].type).toBe("issue");
    // 같은 체크를 다시 저장해도 이슈가 중복 생성되지 않는다
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: DAY, itemKey: "round", roundNo: 1, sessionId: sid, grade: "p", penaltyRuleId: rule.id, isIssue: true });
    expect(await db.select().from(issues)).toHaveLength(1);
  });

  it("일별 항목(출석)은 회차 0으로 저장되고 등원시간·CALL을 기록한다", async () => {
    const t = await seedMembers();
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: DAY, itemKey: "attendance", roundNo: 0, grade: "b", arrivalTime: "09:10", called: true });
    const [row] = await db.select().from(checks).where(eq(checks.memberId, t.a));
    expect(row).toMatchObject({ itemKey: "attendance", roundNo: 0, grade: "b", arrivalTime: "09:10:00", called: true, sessionId: null });
  });
});

describe("회차 완료", () => {
  beforeEach(resetDb);

  it("미입력 회원은 a로 채우고 요약을 돌려준다", async () => {
    const t = await seedMembers();
    const sid = await startSession(t.asstCtx1, DAY);
    const rule = t.rules.find((r) => r.name === "지각")!;
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: DAY, itemKey: "round", roundNo: 1, sessionId: sid, grade: "p", penaltyRuleId: rule.id, isIssue: true });
    const summary = await completeSession(t.asstCtx1, sid);
    expect(summary).toEqual({ penalties: 1, points: 4, issues: 1, absent: 0, total: 2 });
    const rows = await db.select().from(checks).where(eq(checks.sessionId, sid));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.memberId === t.b)?.grade).toBe("a");
    const [sess] = await db.select().from(roundingSessions).where(eq(roundingSessions.id, sid));
    expect(sess.completedAt).not.toBeNull();
  });

  it("타 지점 세션은 완료할 수 없다", async () => {
    const t = await seedMembers();
    const sid = await startSession(t.asstCtx1, DAY);
    await expect(completeSession(t.mgrCtx2, sid)).rejects.toThrow(NotFoundError);
  });
});

describe("회원별 주간 체크", () => {
  beforeEach(resetDb);

  it("회원의 한 주 일별 항목·회차 등급과 벌점 합계를 준다", async () => {
    const t = await seedMembers();
    const { memberWeek } = await import("@/modules/rounding/repo");
    const sid = await startSession(t.asstCtx1, "2026-09-01");
    const sleepy = t.rules.find((r) => r.name === "졸음")!;
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: "2026-09-01", itemKey: "round", roundNo: 1, sessionId: sid, grade: "p", penaltyRuleId: sleepy.id });
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: "2026-09-01", itemKey: "attendance", roundNo: 0, grade: "a" });
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: "2026-09-03", itemKey: "vocab", roundNo: 0, grade: "b" });
    const w = await memberWeek(t.mgrCtx1, t.a, "2026-08-31");
    expect(w.weekStart).toBe("2026-08-31");
    expect(w.days).toHaveLength(7);
    expect(w.cells["2026-09-01|round|1"]).toMatchObject({ grade: "p", points: 3 });
    expect(w.cells["2026-09-01|attendance|0"]).toMatchObject({ grade: "a" });
    expect(w.cells["2026-09-03|vocab|0"]).toMatchObject({ grade: "b" });
    expect(w.totalPoints).toBe(3);
    await expect(memberWeek(t.mgrCtx2, t.a, "2026-08-31")).rejects.toThrow(NotFoundError);
  });
});

describe("라운딩과 일별 체크를 한 번에", () => {
  beforeEach(resetDb);

  async function seedItems() {
    const t = await seedMembers();
    await db.insert(boardItems).values([
      { key: "attendance", label: "출석", kind: "daily", sort: 1 },
      { key: "planner", label: "플래너", kind: "daily", sort: 2 },
      { key: "vocab", label: "영단어", kind: "daily", sort: 3 },
      { key: "checkout", label: "점검완료", kind: "daily", sort: 4 },
      { key: "round", label: "라운딩", kind: "round", sort: 5 },
    ]);
    return t;
  }

  it("회차 시트에 함께 기록할 일별 항목이 같이 온다. 기본은 출석·플래너·영단어, 설정하면 그대로", async () => {
    const t = await seedItems();
    const sid = await startSession(t.asstCtx1, DAY);
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: DAY, itemKey: "planner", roundNo: 0, grade: "b" });
    const sheet = await sessionSheet(t.asstCtx1, sid);
    expect(sheet.companions.map((c) => [c.key, c.label])).toEqual([["attendance", "출석"], ["planner", "플래너"], ["vocab", "영단어"]]);
    expect(sheet.companions[1].rows.map((r) => [r.name, r.grade])).toEqual([["라마바", null], ["가나다", "b"]]);

    const only = { ...t.asstCtx1, settings: { ...t.asstCtx1.settings, roundCompanions: ["checkout", "없는항목"] } };
    expect((await roundCompanions(only, DAY)).map((c) => c.key)).toEqual(["checkout"]);
    const none = { ...t.asstCtx1, settings: { ...t.asstCtx1.settings, roundCompanions: [] } };
    expect(await roundCompanions(none, DAY)).toEqual([]);
  });

  it("출석 자동 처리: 켠 지점에서만, 자리에 있던 학생만, 이미 적힌 출석은 건드리지 않는다", async () => {
    const t = await seedItems();
    const sid = await startSession(t.asstCtx1, DAY);
    const attendance = async () => (await db.select().from(checks).where(eq(checks.itemKey, "attendance"))).map((c) => [c.memberId === t.a ? "가나다" : "라마바", c.grade, c.arrivalTime?.slice(0, 5) ?? null]);

    // 꺼져 있으면 아무 일도 없다
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: DAY, itemKey: "round", roundNo: 1, sessionId: sid, grade: "a" });
    expect(await attendance()).toEqual([]);

    const on = { ...t.asstCtx1, settings: { ...t.asstCtx1.settings, autoAttendance: true } };
    // 부재는 출석이 아니다
    await upsertCheck(on, { memberId: t.b, date: DAY, itemKey: "round", roundNo: 1, sessionId: sid, grade: "na" });
    expect(await attendance()).toEqual([]);
    await upsertCheck(on, { memberId: t.a, date: DAY, itemKey: "round", roundNo: 1, sessionId: sid, grade: "b" });
    expect(await attendance()).toEqual([["가나다", "a", null]]);

    // 지각으로 고쳐 둔 출석은 다음 회차가 덮어쓰지 않는다
    await upsertCheck(on, { memberId: t.a, date: DAY, itemKey: "attendance", roundNo: 0, grade: "b", arrivalTime: "10:40" });
    const sid2 = await startSession(t.asstCtx1, DAY);
    await upsertCheck(on, { memberId: t.a, date: DAY, itemKey: "round", roundNo: 2, sessionId: sid2, grade: "a" });
    expect(await attendance()).toEqual([["가나다", "b", "10:40"]]);
  });

  it("나머지 a 채우기: 미입력만 채우고, 출석·라운딩·없는 항목은 거부한다", async () => {
    const t = await seedItems();
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: DAY, itemKey: "planner", roundNo: 0, grade: "b" });
    expect(await fillRemaining(t.asstCtx1, DAY, "planner")).toBe(1);
    const planner = await db.select().from(checks).where(eq(checks.itemKey, "planner"));
    expect(planner.map((c) => c.grade).sort()).toEqual(["a", "b"]);
    expect(planner.every((c) => c.branchId === t.asstCtx1.branchId)).toBe(true);
    expect(await fillRemaining(t.asstCtx1, DAY, "planner")).toBe(0);

    await expect(fillRemaining(t.asstCtx1, DAY, "attendance")).rejects.toThrow(/한꺼번에/);
    await expect(fillRemaining(t.asstCtx1, DAY, "round")).rejects.toThrow(/한꺼번에/);
    await expect(fillRemaining(t.asstCtx1, DAY, "nope")).rejects.toThrow(NotFoundError);
    await expect(fillRemaining(t.mentorCtx1, DAY, "vocab")).rejects.toThrow(ForbiddenError);
  });
});
