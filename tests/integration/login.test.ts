import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { branches, memberships, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { authenticate, LOCK_MINUTES, MAX_FAILED_LOGINS } from "@/modules/auth/login";
import { resetDb } from "./setup";

async function seedUser() {
  const [b] = await db.insert(branches).values({ code: "B1", name: "지점1" }).returning();
  const [u] = await db.insert(users).values({ loginId: "mgr", name: "지점장", passwordHash: await hashPassword("secret12") }).returning();
  await db.insert(memberships).values({ userId: u.id, branchId: b.id, role: "branch_manager" });
  return { b, u };
}

const T0 = new Date(2026, 8, 5, 10, 0, 0);
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

describe("로그인 잠금", () => {
  beforeEach(resetDb);

  it("올바른 비밀번호면 성공하고 실패 횟수가 0으로 돌아간다", async () => {
    const { u } = await seedUser();
    await authenticate("mgr", "wrong", T0);
    const r = await authenticate("mgr", "secret12", T0);
    expect(r).toEqual({ ok: true, userId: u.id });
    const [row] = await db.select().from(users);
    expect(row.failedLogins).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it(`${MAX_FAILED_LOGINS}회 실패하면 ${LOCK_MINUTES}분 잠기고, 잠긴 동안은 맞는 비밀번호도 거부한다`, async () => {
    const { u } = await seedUser();
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) {
      expect(await authenticate("mgr", "wrong", T0)).toEqual({ ok: false, reason: "invalid", remaining: MAX_FAILED_LOGINS - 1 - i, userId: u.id });
    }
    const locked = await authenticate("mgr", "wrong", T0);
    expect(locked).toEqual({ ok: false, reason: "locked", until: min(LOCK_MINUTES), userId: u.id, justLocked: true });
    expect(await authenticate("mgr", "secret12", min(1))).toEqual({ ok: false, reason: "locked", until: min(LOCK_MINUTES), userId: u.id, justLocked: false });
    // 잠금이 풀리면 정상 로그인
    const r = await authenticate("mgr", "secret12", min(LOCK_MINUTES + 1));
    expect(r.ok).toBe(true);
  });

  it("없는 아이디·비활성 사용자는 같은 메시지로 거부한다 (계정 존재 여부 노출 금지)", async () => {
    const { u } = await seedUser();
    expect(await authenticate("nobody", "x", T0)).toEqual({ ok: false, reason: "invalid" });
    await db.update(users).set({ active: false }).where((await import("drizzle-orm")).eq(users.id, u.id));
    expect(await authenticate("mgr", "secret12", T0)).toEqual({ ok: false, reason: "invalid" });
  });
});
