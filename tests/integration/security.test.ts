import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { authSessions, memberships, securityEvents, users } from "@/db/schema";
import { buildCtx, type Ctx } from "@/lib/auth/ctx";
import { hashPassword, needsRehash } from "@/lib/auth/password";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { authenticate, MAX_FAILED_LOGINS } from "@/modules/auth/login";
import { switchByPin } from "@/modules/auth/pin";
import { changeOwnPassword, logoutOtherDevices } from "@/modules/security/account";
import { failureHotspots, listSecurityEvents, purgeSecurityEvents, recordSecurityEvent } from "@/modules/security/events";
import { activeSession, createSession, listActiveSessions, purgeOldSessions, revokeSession } from "@/modules/security/sessions";
import { forceLogoutUser, setUserPin, unlockUser, upsertUser } from "@/modules/settings/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

const meta = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (iPhone) Safari/605" };

async function withPassword(userId: string, pw = "Password123") {
  await db.update(users).set({ passwordHash: await hashPassword(pw) }).where(eq(users.id, userId));
}

describe("서버 세션", () => {
  beforeEach(resetDb);

  it("살아 있는 세션만 통과한다 — 폐기·만료·남의 세션 번호는 거부", async () => {
    const t = await seedTwoBranches();
    const sid = await createSession(t.users.mgr1.id, "password", meta);
    expect(await activeSession(sid, t.users.mgr1.id)).toEqual({ branchId: null, method: "password" });
    // 다른 사람의 쿠키에 이 세션 번호를 넣어도 안 된다
    expect(await activeSession(sid, t.users.asst1.id)).toBeNull();
    // 만료 뒤
    expect(await activeSession(sid, t.users.mgr1.id, undefined, new Date(Date.now() + 13 * 3600_000))).toBeNull();
    // 로그아웃(폐기) 뒤
    await revokeSession(sid);
    expect(await activeSession(sid, t.users.mgr1.id)).toBeNull();
    // 모양이 틀린 값은 DB 에 묻지도 않는다
    expect(await activeSession("not-a-uuid", t.users.mgr1.id)).toBeNull();
  });

  it("PIN 세션은 그 지점에만 묶인다 — 다른 지점 권한으로 넘어갈 수 없다", async () => {
    const t = await seedTwoBranches();
    // 조교1이 다른 지점에서는 지점장이라고 하자
    await db.insert(memberships).values({ userId: t.users.asst1.id, branchId: t.b2.id, role: "branch_manager" });
    const free = (await buildCtx(t.users.asst1.id, t.b2.id))!;
    expect(free.memberships).toHaveLength(2);
    const locked = (await buildCtx(t.users.asst1.id, t.b2.id, { lockBranchId: t.b1.id }))!;
    expect(locked.memberships.map((m) => m.branchId)).toEqual([t.b1.id]);
    expect(locked.branchId).toBe(t.b1.id);
    expect(locked.role).toBe("assistant");
  });

  it("관리자가 비밀번호를 바꾸거나 계정을 끄면 그 사람의 모든 기기가 끊기고 기록이 남는다", async () => {
    const t = await seedTwoBranches();
    const a = await createSession(t.users.asst1.id, "password", meta);
    const b = await createSession(t.users.asst1.id, "pin", { ...meta, branchId: t.b1.id });
    await upsertUser(t.mgrCtx1, { id: t.users.asst1.id, loginId: "asst1", name: "조교1", role: "assistant", active: true, password: "NewPassword1" });
    expect(await activeSession(a, t.users.asst1.id)).toBeNull();
    expect(await activeSession(b, t.users.asst1.id)).toBeNull();
    const [ev] = await db.select().from(securityEvents).where(eq(securityEvents.kind, "password.changed"));
    expect(ev).toMatchObject({ userId: t.users.asst1.id, actorId: t.users.mgr1.id });

    const c = await createSession(t.users.asst1.id, "password", meta);
    await upsertUser(t.mgrCtx1, { id: t.users.asst1.id, loginId: "asst1", name: "조교1", role: "assistant", active: false });
    expect(await activeSession(c, t.users.asst1.id)).toBeNull();
  });

  it("오래된 세션 행은 보관 배치가 지운다", async () => {
    const t = await seedTwoBranches();
    const old = new Date(Date.now() - 40 * 24 * 3600_000);
    await createSession(t.users.mgr1.id, "password", meta, db, old);
    const live = await createSession(t.users.mgr1.id, "password", meta);
    expect(await purgeOldSessions()).toBe(1);
    expect((await db.select().from(authSessions)).map((s) => s.id)).toEqual([live]);
  });
});

describe("내 계정", () => {
  beforeEach(resetDb);

  async function ctxWithSession(userId: string, branchId: string): Promise<Ctx> {
    const sid = await createSession(userId, "password", meta);
    return { ...((await buildCtx(userId, branchId)) as Ctx), sessionId: sid };
  }

  it("지금 비밀번호가 맞아야 바꿀 수 있고, 바꾸면 다른 기기는 끊기고 이 기기는 새 세션으로 이어진다", async () => {
    const t = await seedTwoBranches();
    await withPassword(t.users.mentor1.id, "OldPassword1");
    const ctx = await ctxWithSession(t.users.mentor1.id, t.b1.id);
    const other = await createSession(t.users.mentor1.id, "password", meta);

    await expect(changeOwnPassword(ctx, "wrong", "NewPassword1", "NewPassword1", meta)).rejects.toThrow(/지금 비밀번호가 맞지 않습니다/);
    await expect(changeOwnPassword(ctx, "OldPassword1", "short1", "short1", meta)).rejects.toThrow(ValidationError);
    await expect(changeOwnPassword(ctx, "OldPassword1", "NewPassword1", "NewPassword2", meta)).rejects.toThrow(/확인이 일치/);

    const { sessionId } = await changeOwnPassword(ctx, "OldPassword1", "NewPassword1", "NewPassword1", meta);
    expect(await activeSession(other, t.users.mentor1.id)).toBeNull();
    expect(await activeSession(ctx.sessionId!, t.users.mentor1.id)).toBeNull();
    expect(await activeSession(sessionId, t.users.mentor1.id)).not.toBeNull();
    expect((await authenticate("mentor1", "NewPassword1")).ok).toBe(true);
    expect((await authenticate("mentor1", "OldPassword1")).ok).toBe(false);
  });

  it(`지금 비밀번호를 ${MAX_FAILED_LOGINS}번 틀리면 로그인처럼 잠긴다 (쿠키를 훔친 사람이 비밀번호를 찍어 볼 수 없게)`, async () => {
    const t = await seedTwoBranches();
    await withPassword(t.users.mentor1.id, "OldPassword1");
    const ctx = await ctxWithSession(t.users.mentor1.id, t.b1.id);
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) await expect(changeOwnPassword(ctx, "nope", "NewPassword1", "NewPassword1", meta)).rejects.toThrow(/맞지 않습니다/);
    await expect(changeOwnPassword(ctx, "nope", "NewPassword1", "NewPassword1", meta)).rejects.toThrow(/잠겼습니다/);
    await expect(changeOwnPassword(ctx, "OldPassword1", "NewPassword1", "NewPassword1", meta)).rejects.toThrow(/잠겼습니다/);
  });

  it("다른 기기 모두 로그아웃은 지금 기기만 남긴다", async () => {
    const t = await seedTwoBranches();
    const ctx = await ctxWithSession(t.users.mgr1.id, t.b1.id);
    await createSession(t.users.mgr1.id, "password", meta);
    await createSession(t.users.mgr1.id, "password", meta);
    expect(await logoutOtherDevices(ctx, meta)).toBe(2);
    const left = await listActiveSessions(t.users.mgr1.id, ctx.sessionId!);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: ctx.sessionId, current: true });
  });
});

describe("계정 탈취 방지 (지점장 권한 범위)", () => {
  beforeEach(resetDb);

  it("다른 지점에서 지점장인 사람은, 우리 지점에선 멘토여도 지점장이 비밀번호·PIN·사용 여부를 바꿀 수 없다", async () => {
    const t = await seedTwoBranches();
    // 멘토1은 지점2에서는 지점장이다
    await db.insert(memberships).values({ userId: t.users.mentor1.id, branchId: t.b2.id, role: "branch_manager" });
    const base = { id: t.users.mentor1.id, loginId: "mentor1", name: "멘토1", role: "mentor" as const, active: true };
    await expect(upsertUser(t.mgrCtx1, { ...base, password: "Takeover123" })).rejects.toThrow(ForbiddenError);
    await expect(upsertUser(t.mgrCtx1, { ...base, active: false })).rejects.toThrow(ForbiddenError);
    await expect(setUserPin(t.mgrCtx1, t.users.mentor1.id, "1234")).rejects.toThrow(ForbiddenError);
    await expect(forceLogoutUser(t.mgrCtx1, t.users.mentor1.id, meta)).rejects.toThrow(ForbiddenError);
    // 본사는 할 수 있다
    await upsertUser(t.hqCtx1, { ...base, password: "HqReset1234" });
  });

  it("다른 지점에도 멘토·조교로만 소속된 사람은, 지점장이 이 지점 역할만 바꿀 수 있다", async () => {
    const t = await seedTwoBranches();
    await db.insert(memberships).values({ userId: t.users.asst1.id, branchId: t.b2.id, role: "assistant" });
    const base = { id: t.users.asst1.id, loginId: "asst1", name: "조교1", role: "assistant" as const, active: true };
    await upsertUser(t.mgrCtx1, { ...base, role: "mentor" });
    const [m] = await db.select().from(memberships).where(eq(memberships.userId, t.users.asst1.id));
    expect(m).toBeTruthy();
    await expect(upsertUser(t.mgrCtx1, { ...base, role: "mentor", name: "바꾼 이름" })).rejects.toThrow(/본사에서/);
    await expect(upsertUser(t.mgrCtx1, { ...base, role: "mentor", password: "NewPassword1" })).rejects.toThrow(/본사에서/);
  });

  it("지점장은 이 지점에만 속한 조교의 모든 기기를 로그아웃시킬 수 있고, 다른 지점장은 못 한다", async () => {
    const t = await seedTwoBranches();
    const sid = await createSession(t.users.asst1.id, "password", meta);
    await expect(forceLogoutUser(t.mgrCtx2, t.users.asst1.id, meta)).rejects.toThrow();
    await expect(forceLogoutUser(t.mgrCtx1, t.users.mgr1.id, meta)).rejects.toThrow(ForbiddenError);
    expect(await forceLogoutUser(t.mgrCtx1, t.users.asst1.id, meta)).toBe(1);
    expect(await activeSession(sid, t.users.asst1.id)).toBeNull();
  });

  it("PIN 실패는 비밀번호 로그인을 잠그지 않고, 잠금 해제는 둘 다 푼다", async () => {
    const t = await seedTwoBranches();
    await withPassword(t.users.asst1.id, "Password123");
    await setUserPin(t.mgrCtx1, t.users.asst1.id, "1234");
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await expect(switchByPin(t.asstCtx1, t.users.asst1.id, "0000")).rejects.toThrow();
    await expect(switchByPin(t.asstCtx1, t.users.asst1.id, "1234")).rejects.toThrow(/잠겼습니다/);
    expect((await authenticate("asst1", "Password123")).ok).toBe(true);
    await unlockUser(t.hqCtx1, t.users.asst1.id);
    await expect(switchByPin(t.asstCtx1, t.users.asst1.id, "1234")).resolves.toMatchObject({ userId: t.users.asst1.id });
  });
});

describe("비밀번호 해시 강도", () => {
  beforeEach(resetDb);

  it("예전(bcrypt 10) 해시로 로그인하면 새 기준으로 다시 저장한다", async () => {
    const t = await seedTwoBranches();
    const bcrypt = (await import("bcryptjs")).default;
    await db.update(users).set({ passwordHash: await bcrypt.hash("Password123", 10) }).where(eq(users.id, t.users.mgr1.id));
    expect((await authenticate("mgr1", "Password123")).ok).toBe(true);
    const [u] = await db.select({ h: users.passwordHash, changed: users.passwordChangedAt }).from(users).where(eq(users.id, t.users.mgr1.id));
    expect(needsRehash(u.h)).toBe(false);
    // 같은 비밀번호라 로그인된 기기를 끊지 않는다
    expect(u.changed).toBeNull();
    expect((await authenticate("mgr1", "Password123")).ok).toBe(true);
  });
});

describe("보안 기록", () => {
  beforeEach(resetDb);

  it("본사만 보고, 실패가 몰린 IP·아이디를 묶어 보여 준다", async () => {
    const t = await seedTwoBranches();
    for (let i = 0; i < 3; i++) await recordSecurityEvent({ kind: "login.failure", loginId: `guess${i}`, ip: "198.51.100.7" });
    await recordSecurityEvent({ kind: "login.failure", loginId: "mgr1", userId: t.users.mgr1.id, ip: "203.0.113.9" });
    await recordSecurityEvent({ kind: "login.success", loginId: "mgr1", userId: t.users.mgr1.id, ip: "203.0.113.9" });

    await expect(listSecurityEvents(t.mgrCtx1)).rejects.toThrow(ForbiddenError);
    await expect(failureHotspots(t.mgrCtx1)).rejects.toThrow(ForbiddenError);
    const rows = await listSecurityEvents(t.hqCtx1);
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.kind === "login.success")?.userName).toBe("지점장1");
    expect(await listSecurityEvents(t.hqCtx1, { kinds: ["login.failure"] })).toHaveLength(4);

    const hot = await failureHotspots(t.hqCtx1);
    expect(hot.byIp[0]).toMatchObject({ key: "198.51.100.7", failures: 3 });
    expect(hot.byLoginId.map((h) => h.key).sort()).toEqual(["guess0", "guess1", "guess2", "mgr1"]);
  });

  it("1년이 지난 기록은 지운다", async () => {
    await seedTwoBranches();
    await db.insert(securityEvents).values({ kind: "login.failure", at: new Date(Date.now() - 400 * 24 * 3600_000) });
    await recordSecurityEvent({ kind: "login.failure" });
    expect(await purgeSecurityEvents(365)).toBe(1);
    expect(await db.select().from(securityEvents)).toHaveLength(1);
  });
});

describe("다른 지점 id 끼워 넣기", () => {
  beforeEach(resetDb);

  it("상담 일정 담당자 목록은 이 지점 직원만, 담당자·회원도 이 지점 것만 받는다", async () => {
    const { schedulePickers, upsertAppointment } = await import("@/modules/schedule/repo");
    const t = await seedTwoBranches();
    const staff = (await schedulePickers(t.mgrCtx1)).staff.map((s) => s.name).sort();
    expect(staff).toEqual(["멘토1", "조교1", "지점장1"]);
    await expect(upsertAppointment(t.mgrCtx1, { date: "2026-09-10", startTime: "10:00", kind: "new", personName: "상담자", assignedTo: t.users.mgr2.id })).rejects.toThrow(/이 지점 직원/);
    await expect(upsertAppointment(t.mgrCtx1, { date: "2026-09-10", startTime: "10:00", kind: "new", personName: "상담자", assignedTo: t.users.hq.id })).rejects.toThrow(/이 지점 직원/);
    await upsertAppointment(t.mgrCtx1, { date: "2026-09-10", startTime: "10:00", kind: "new", personName: "상담자", assignedTo: t.users.mentor1.id });
  });

  it("이슈 담당자는 이 지점 직원만", async () => {
    const { createIssue, updateIssue } = await import("@/modules/issues/repo");
    const t = await seedTwoBranches();
    const id = await createIssue(t.mgrCtx1, { memberId: null, title: "에어컨", body: null, severity: "normal", source: "rounding" });
    await expect(updateIssue(t.mgrCtx1, id, { assignedTo: t.users.mgr2.id })).rejects.toThrow(/이 지점 직원/);
    await updateIssue(t.mgrCtx1, id, { assignedTo: t.users.mentor1.id });
  });

  it("좌석 요금 등급은 이 지점 것만", async () => {
    const { setSeatFeePlan, upsertFeePlan } = await import("@/modules/payments/repo");
    const t = await seedTwoBranches();
    const other = await upsertFeePlan(t.mgrCtx2, { name: "B2 원목", studentPrice: 1, adultPrice: 1, sort: 1, active: true });
    const mine = await upsertFeePlan(t.mgrCtx1, { name: "B1 원목", studentPrice: 1, adultPrice: 1, sort: 1, active: true });
    await expect(setSeatFeePlan(t.mgrCtx1, t.seats1[0].id, other)).rejects.toThrow(/이 지점의 요금 등급/);
    await setSeatFeePlan(t.mgrCtx1, t.seats1[0].id, mine);
  });
});
