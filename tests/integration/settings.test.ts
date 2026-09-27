import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { boardItems, memberships, users } from "@/db/schema";
import { buildCtx } from "@/lib/auth/ctx";
import { verifyPassword } from "@/lib/auth/password";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { penaltyRulesFor } from "@/modules/rounding/repo";
import { boardItemsFor, getBranch, listAuditLogs, listUsers, updateBranchSettings, upsertBoardItem, upsertPenaltyRule, upsertSeat, upsertUser } from "@/modules/settings/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

describe("설정 · 현황판 항목과 벌점 규칙", () => {
  beforeEach(resetDb);

  it("지점 항목이 없으면 본사 기본, 첫 지점 항목을 만들면 기본 항목을 지점으로 옮겨 함께 쓴다", async () => {
    const t = await seedTwoBranches();
    await db.insert(boardItems).values([
      { key: "attendance", label: "출석", kind: "daily", sort: 1 },
      { key: "round", label: "라운딩", kind: "round", sort: 2 },
    ]);
    expect((await boardItemsFor(t.mgrCtx1)).map((i) => i.key)).toEqual(["attendance", "round"]);
    await upsertBoardItem(t.mgrCtx1, { key: "planner", label: "플래너", kind: "daily", sort: 1, active: true });
    // 기본 항목이 사라지면 라운딩 표의 출석·R1~Rn 열이 없어진다
    expect((await boardItemsFor(t.mgrCtx1)).map((i) => i.key)).toEqual(["attendance", "planner", "round"]);
    await upsertBoardItem(t.mgrCtx1, { key: "homework", label: "과제", kind: "daily", sort: 3, active: true });
    expect((await boardItemsFor(t.mgrCtx1)).map((i) => i.key)).toEqual(["attendance", "planner", "round", "homework"]);
    expect((await boardItemsFor(t.mgrCtx2)).map((i) => i.key)).toEqual(["attendance", "round"]);
  });

  it("지점장이 벌점 규칙을 만들면 그 지점은 지점 규칙만 쓴다", async () => {
    const t = await seedTwoBranches();
    await expect(upsertPenaltyRule(t.mentorCtx1, { name: "x", points: 1, sort: 1, active: true })).rejects.toThrow(ForbiddenError);
    await upsertPenaltyRule(t.mgrCtx1, { name: "지점 규칙", points: 7, sort: 1, active: true });
    expect((await penaltyRulesFor(t.mgrCtx1)).map((r) => r.name)).toEqual(["지점 규칙"]);
    expect((await penaltyRulesFor(t.mgrCtx2)).map((r) => r.name)).toEqual(["졸음", "지각", "이동금지 위반"]);
  });

  it("본사 관리자는 기본 규칙(전 지점)을 수정한다", async () => {
    const t = await seedTwoBranches();
    const sleepy = t.rules.find((r) => r.name === "졸음")!;
    await upsertPenaltyRule(t.hqCtx1, { id: sleepy.id, name: "졸음", points: 2, sort: 1, active: true, global: true });
    expect((await penaltyRulesFor(t.mgrCtx2)).find((r) => r.name === "졸음")?.points).toBe(2);
  });
});

describe("설정 · 지점과 좌석", () => {
  beforeEach(resetDb);

  it("지점 설정은 부분 갱신된다", async () => {
    const t = await seedTwoBranches();
    await updateBranchSettings(t.mgrCtx1, { roundsPerDay: 10 });
    const b = await getBranch(t.mgrCtx1);
    expect(b.settings).toMatchObject({ roundsPerDay: 10, maskNames: false });
    await updateBranchSettings(t.mgrCtx1, { maskNames: true });
    expect((await getBranch(t.mgrCtx1)).settings).toMatchObject({ roundsPerDay: 10, maskNames: true });
  });

  it("같은 좌석번호는 만들 수 없고, 수정은 가능하다", async () => {
    const t = await seedTwoBranches();
    await expect(upsertSeat(t.mgrCtx1, { seatNo: 1, zone: "B", sort: 1, active: true })).rejects.toThrow(ValidationError);
    await upsertSeat(t.mgrCtx1, { id: t.seats1[0].id, seatNo: 1, zone: "B", sort: 1, active: false });
    const [row] = await db.select().from((await import("@/db/schema")).seats).where(eq((await import("@/db/schema")).seats.id, t.seats1[0].id));
    expect(row).toMatchObject({ zone: "B", active: false });
  });
});

describe("설정 · 사용자", () => {
  beforeEach(resetDb);

  it("지점장은 멘토·조교만 만들 수 있고, 만든 계정으로 로그인 검증이 된다", async () => {
    const t = await seedTwoBranches();
    await expect(upsertUser(t.mgrCtx1, { loginId: "newmgr", name: "새지점장", password: "pw12345678", role: "branch_manager", active: true })).rejects.toThrow(ForbiddenError);
    const id = await upsertUser(t.mgrCtx1, { loginId: "newasst", name: "새조교", password: "pw12345678", role: "assistant", active: true });
    const [u] = await db.select().from(users).where(eq(users.id, id));
    expect(await verifyPassword("pw12345678", u.passwordHash)).toBe(true);
    const ctx = await buildCtx(id, null);
    expect(ctx?.role).toBe("assistant");
    expect(ctx?.branchId).toBe(t.b1.id);
    expect((await listUsers(t.mgrCtx1)).map((x) => x.loginId)).toContain("newasst");
    expect((await listUsers(t.mgrCtx2)).map((x) => x.loginId)).not.toContain("newasst");
  });

  it("본사 관리자는 지점장을 만들고, 기존 사용자의 역할·비활성을 바꾼다", async () => {
    const t = await seedTwoBranches();
    const id = await upsertUser(t.hqCtx1, { loginId: "mgr3", name: "지점장3", password: "pw12345678", role: "branch_manager", active: true });
    await upsertUser(t.hqCtx1, { id, loginId: "mgr3", name: "지점장3", role: "mentor", active: false });
    const [ms] = await db.select().from(memberships).where(eq(memberships.userId, id));
    expect(ms.role).toBe("mentor");
    expect(await buildCtx(id, null)).toBeNull();
  });

  it("아이디 중복은 오류", async () => {
    const t = await seedTwoBranches();
    await expect(upsertUser(t.mgrCtx1, { loginId: "mentor1", name: "x", password: "pw12345678", role: "assistant", active: true })).rejects.toThrow(ValidationError);
  });
});

describe("설정 · 감사 로그", () => {
  beforeEach(resetDb);

  it("지점의 변경 이력을 행위자 이름과 함께 최신순으로 준다", async () => {
    const t = await seedTwoBranches();
    await updateBranchSettings(t.mgrCtx1, { roundsPerDay: 9 });
    await updateBranchSettings(t.mgrCtx2, { roundsPerDay: 8 });
    const rows = await listAuditLogs(t.mgrCtx1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "branch", action: "update", actorName: "지점장1" });
    expect(rows[0].after).toMatchObject({ roundsPerDay: 9 });
    await expect(listAuditLogs(t.mentorCtx1)).rejects.toThrow(ForbiddenError);
  });
});
