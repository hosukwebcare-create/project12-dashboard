import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { branches, memberships, users } from "@/db/schema";
import { buildCtx, requireRole, type Ctx } from "@/lib/auth/ctx";
import { ForbiddenError } from "@/lib/errors";
import { resetDb } from "./setup";

async function seedBasic() {
  const [b1] = await db.insert(branches).values({ code: "B1", name: "지점1" }).returning();
  const [b2] = await db.insert(branches).values({ code: "B2", name: "지점2" }).returning();
  const [hq] = await db
    .insert(users)
    .values({ loginId: "hq", name: "본사", passwordHash: "x", isHqAdmin: true })
    .returning();
  const [mgr] = await db.insert(users).values({ loginId: "mgr", name: "지점장", passwordHash: "x" }).returning();
  const [multi] = await db.insert(users).values({ loginId: "multi", name: "겸임멘토", passwordHash: "x" }).returning();
  const [inactive] = await db
    .insert(users)
    .values({ loginId: "off", name: "퇴사", passwordHash: "x", active: false })
    .returning();
  await db.insert(memberships).values([
    { userId: mgr.id, branchId: b1.id, role: "branch_manager" },
    { userId: multi.id, branchId: b1.id, role: "mentor" },
    { userId: multi.id, branchId: b2.id, role: "assistant" },
    { userId: inactive.id, branchId: b1.id, role: "mentor" },
  ]);
  return { b1, b2, hq, mgr, multi, inactive };
}

describe("buildCtx", () => {
  beforeEach(resetDb);

  it("지점장은 소속 지점에서 branch_manager 역할을 받는다", async () => {
    const { b1, mgr } = await seedBasic();
    const ctx = await buildCtx(mgr.id, null);
    expect(ctx?.branchId).toBe(b1.id);
    expect(ctx?.branchName).toBe("지점1");
    expect(ctx?.role).toBe("branch_manager");
    expect(ctx?.isHqAdmin).toBe(false);
    expect(ctx?.settings.roundsPerDay).toBe(12);
  });

  it("소속이 아닌 지점을 요청하면 소속 지점으로 되돌린다", async () => {
    const { b1, b2, mgr } = await seedBasic();
    const ctx = await buildCtx(mgr.id, b2.id);
    expect(ctx?.branchId).toBe(b1.id);
  });

  it("겸임 사용자는 요청한 지점의 역할을 받는다", async () => {
    const { b1, b2, multi } = await seedBasic();
    expect((await buildCtx(multi.id, b2.id))?.role).toBe("assistant");
    expect((await buildCtx(multi.id, b1.id))?.role).toBe("mentor");
    expect((await buildCtx(multi.id, b2.id))?.memberships).toHaveLength(2);
  });

  it("본사 관리자는 어떤 지점이든 hq_admin 역할이고 전 지점 목록을 가진다", async () => {
    const { b1, b2, hq } = await seedBasic();
    const ctx = await buildCtx(hq.id, b2.id);
    expect(ctx?.branchId).toBe(b2.id);
    expect(ctx?.role).toBe("hq_admin");
    expect(ctx?.memberships.map((m) => m.branchId).sort()).toEqual([b1.id, b2.id].sort());
  });

  it("본사 관리자가 지점을 지정하지 않으면 첫 지점", async () => {
    const { b1, hq } = await seedBasic();
    expect((await buildCtx(hq.id, null))?.branchId).toBe(b1.id);
  });

  it("비활성 사용자와 없는 사용자는 null", async () => {
    const { inactive } = await seedBasic();
    expect(await buildCtx(inactive.id, null)).toBeNull();
    expect(await buildCtx("00000000-0000-0000-0000-000000000000", null)).toBeNull();
  });
});

describe("requireRole", () => {
  it("허용 목록에 없는 역할은 ForbiddenError", () => {
    const ctx = { role: "mentor" } as Ctx;
    expect(() => requireRole(ctx, "branch_manager", "hq_admin")).toThrow(ForbiddenError);
  });
  it("허용 목록에 있으면 통과", () => {
    const ctx = { role: "hq_admin" } as Ctx;
    expect(() => requireRole(ctx, "branch_manager", "hq_admin")).not.toThrow();
  });
});
