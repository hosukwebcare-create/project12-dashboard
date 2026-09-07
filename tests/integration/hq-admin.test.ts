import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditLogs, users } from "@/db/schema";
import { buildCtx } from "@/lib/auth/ctx";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { authenticate } from "@/modules/auth/login";
import { listHqAdmins, unlockUser, upsertHqAdmin, upsertUser } from "@/modules/settings/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

describe("본사 관리자 계정", () => {
  beforeEach(resetDb);

  it("본사 관리자만 다른 본사 관리자를 만든다", async () => {
    const t = await seedTwoBranches();
    await expect(upsertHqAdmin(t.mgrCtx1, { loginId: "hq2", name: "본사2", password: "pw12345678", active: true })).rejects.toThrow(ForbiddenError);

    const id = await upsertHqAdmin(t.hqCtx1, { loginId: "hq2", name: "본사2", password: "pw12345678", active: true });
    const [u] = await db.select().from(users).where(eq(users.id, id));
    expect(u.isHqAdmin).toBe(true);
    expect(await verifyPassword("pw12345678", u.passwordHash)).toBe(true);

    // 지점 소속이 없어도 모든 지점이 보인다
    const ctx = await buildCtx(id, null);
    expect(ctx?.role).toBe("hq_admin");
    expect(ctx?.memberships).toHaveLength(2);
  });

  it("목록에는 본사 계정만 나오고 자기 계정이 표시된다", async () => {
    const t = await seedTwoBranches();
    const rows = await listHqAdmins(t.hqCtx1);
    expect(rows.map((r) => r.loginId)).toEqual(["hq"]);
    expect(rows[0].isSelf).toBe(true);
  });

  it("비밀번호 정책과 아이디 중복을 지킨다", async () => {
    const t = await seedTwoBranches();
    await expect(upsertHqAdmin(t.hqCtx1, { loginId: "hq2", name: "본사2", password: "짧다123", active: true })).rejects.toThrow(ValidationError);
    await expect(upsertHqAdmin(t.hqCtx1, { loginId: "mgr1", name: "본사2", password: "pw12345678", active: true })).rejects.toThrow(ValidationError);
  });

  it("마지막 본사 관리자와 자기 계정은 끌 수 없다", async () => {
    const t = await seedTwoBranches();
    await expect(upsertHqAdmin(t.hqCtx1, { id: t.users.hq.id, loginId: "hq", name: "본사", active: false })).rejects.toThrow(ValidationError);

    const other = await upsertHqAdmin(t.hqCtx1, { loginId: "hq2", name: "본사2", password: "pw12345678", active: true });
    // 둘이 되었어도 자기 자신은 여전히 못 끈다
    await expect(upsertHqAdmin(t.hqCtx1, { id: t.users.hq.id, loginId: "hq", name: "본사", active: false })).rejects.toThrow(ValidationError);
    // 다른 계정은 끌 수 있다
    await upsertHqAdmin(t.hqCtx1, { id: other, loginId: "hq2", name: "본사2", active: false });
    expect(await buildCtx(other, null)).toBeNull();
  });

  it("비밀번호를 바꾸면 잠금이 풀리고 감사 로그에 비밀번호가 남지 않는다", async () => {
    const t = await seedTwoBranches();
    await db.update(users).set({ lockedUntil: new Date(Date.now() + 600_000), failedLogins: 5 }).where(eq(users.id, t.users.hq.id));

    await upsertHqAdmin(t.hqCtx1, { id: t.users.hq.id, loginId: "hq", name: "본사", password: "newpw123456", active: true });
    expect(await authenticate("hq", "newpw123456")).toEqual({ ok: true, userId: t.users.hq.id });

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, t.users.hq.id));
    expect(JSON.stringify(logs)).not.toContain("newpw123456");
  });

  it("잠긴 계정을 본사 관리자가 즉시 풀어 준다", async () => {
    const t = await seedTwoBranches();
    await db
      .update(users)
      .set({ passwordHash: await hashPassword("pw12345678"), lockedUntil: new Date(Date.now() + 600_000) })
      .where(eq(users.id, t.users.mentor1.id));
    expect((await authenticate("mentor1", "pw12345678")).ok).toBe(false);

    await expect(unlockUser(t.mgrCtx1, t.users.mentor1.id)).rejects.toThrow(ForbiddenError);
    await unlockUser(t.hqCtx1, t.users.mentor1.id);
    expect((await authenticate("mentor1", "pw12345678")).ok).toBe(true);
  });
});

describe("비밀번호를 바꾸면 기존 세션이 끊긴다", () => {
  beforeEach(resetDb);

  it("바꾸기 전에 발급된 토큰으로는 컨텍스트를 못 만든다", async () => {
    const t = await seedTwoBranches();
    const id = await upsertUser(t.mgrCtx1, { loginId: "asst9", name: "조교9", password: "pw12345678", role: "assistant", active: true });
    const issuedAt = Math.floor(Date.now() / 1000);
    expect(await buildCtx(id, null, { issuedAt })).not.toBeNull();

    // 비밀번호 변경 시각을 토큰 발급보다 확실히 뒤로 둔다
    await upsertUser(t.mgrCtx1, { id, loginId: "asst9", name: "조교9", password: "newpw123456", role: "assistant", active: true });
    await db.update(users).set({ passwordChangedAt: new Date((issuedAt + 60) * 1000) }).where(eq(users.id, id));

    expect(await buildCtx(id, null, { issuedAt })).toBeNull();
    expect(await buildCtx(id, null, { issuedAt: issuedAt + 120 })).not.toBeNull();
    expect(await buildCtx(id, null)).not.toBeNull(); // 발급 시각을 안 주는 배치·스크립트는 영향 없다
  });
});

describe("한 사람이 여러 지점을 맡는 경우", () => {
  beforeEach(resetDb);

  it("본사 관리자가 기존 계정을 다른 지점에도 소속시킨다", async () => {
    const t = await seedTwoBranches();
    const { addUserToBranch, listUsers } = await import("@/modules/settings/repo");

    // 지점1 지점장을 지점2에도 (점주가 직영 두 곳을 맡는 구조)
    await expect(addUserToBranch(t.mgrCtx2, "mgr1", "branch_manager")).rejects.toThrow(ForbiddenError);
    const hqCtx2 = (await buildCtx(t.users.hq.id, t.b2.id))!;
    await addUserToBranch(hqCtx2, "mgr1", "branch_manager");

    const ctx = await buildCtx(t.users.mgr1.id, null);
    expect(ctx?.memberships.map((m) => m.branchName).sort()).toEqual(["지점1", "지점2"]);

    // 목록에 함께 맡는 지점이 보인다
    expect((await listUsers(hqCtx2)).find((u) => u.loginId === "mgr1")?.otherBranches).toEqual(["지점1"]);
    expect((await listUsers(t.hqCtx1)).find((u) => u.loginId === "mgr1")?.otherBranches).toEqual(["지점2"]);
  });

  it("없는 아이디·중복 추가·본사 계정은 막는다", async () => {
    const t = await seedTwoBranches();
    const { addUserToBranch } = await import("@/modules/settings/repo");
    await expect(addUserToBranch(t.hqCtx1, "없는아이디", "mentor")).rejects.toThrow(/계정이 없습니다/);
    await expect(addUserToBranch(t.hqCtx1, "mentor1", "mentor")).rejects.toThrow(/이미 이 지점 소속/);
    await expect(addUserToBranch(t.hqCtx1, "hq", "mentor")).rejects.toThrow(/모든 지점을 봅니다/);
  });

  it("마지막 소속 지점에서는 뺄 수 없다", async () => {
    const t = await seedTwoBranches();
    const { addUserToBranch, removeUserFromBranch } = await import("@/modules/settings/repo");
    await expect(removeUserFromBranch(t.hqCtx1, t.users.mentor1.id)).rejects.toThrow(/마지막 소속 지점/);

    const hqCtx2 = (await buildCtx(t.users.hq.id, t.b2.id))!;
    await addUserToBranch(hqCtx2, "mentor1", "mentor");
    await removeUserFromBranch(hqCtx2, t.users.mentor1.id);
    expect((await buildCtx(t.users.mentor1.id, null))?.memberships.map((m) => m.branchName)).toEqual(["지점1"]);
  });
});
