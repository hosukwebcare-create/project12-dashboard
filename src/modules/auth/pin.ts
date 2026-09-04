import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { memberships, users } from "@/db/schema";
import type { Ctx } from "@/lib/auth/ctx";
import { verifyPassword } from "@/lib/auth/password";
import { ForbiddenError, ValidationError } from "@/lib/errors";

/** 현재 지점에서 PIN 전환이 가능한 조교 목록 */
export async function listPinUsers(ctx: Ctx, db: Db = defaultDb): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.branchId, ctx.branchId), eq(memberships.role, "assistant"), eq(users.active, true), isNotNull(users.pinHash)))
    .orderBy(asc(users.name));
}

/**
 * 공용 태블릿에서 PIN으로 다른 조교 계정으로 전환한다.
 * 이미 로그인된 세션(같은 지점)이 있어야 하며, 대상은 PIN이 설정된 활성 조교만 가능하다.
 */
export async function switchByPin(ctx: Ctx, userId: string, pin: string, db: Db = defaultDb): Promise<{ userId: string; branchId: string }> {
  const [target] = await db
    .select({ id: users.id, pinHash: users.pinHash, active: users.active, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), eq(memberships.branchId, ctx.branchId)))
    .limit(1);
  if (!target) {
    const [elsewhere] = await db.select({ id: memberships.userId }).from(memberships).where(eq(memberships.userId, userId)).limit(1);
    if (elsewhere) throw new ForbiddenError("다른 지점의 사용자로는 전환할 수 없습니다");
    throw new ValidationError("전환할 수 없는 사용자입니다");
  }
  if (target.role !== "assistant" || !target.active || !target.pinHash) throw new ValidationError("전환할 수 없는 사용자입니다");
  if (!(await verifyPassword(pin, target.pinHash))) throw new ValidationError("PIN이 올바르지 않습니다");
  return { userId: target.id, branchId: ctx.branchId };
}
