import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { memberships, users } from "@/db/schema";
import type { Ctx } from "@/lib/auth/ctx";
import { verifyPassword } from "@/lib/auth/password";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { LOCK_MINUTES, MAX_FAILED_LOGINS } from "./login";

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
 * PIN 은 4~6자리라 무제한 시도가 위험하므로 실패 잠금(5회/10분)을 대상 계정에 건다.
 * 잠금은 비밀번호 잠금과 따로 센다 — 같이 세면 PIN 을 몇 번 틀리는 것만으로 그 사람의 비밀번호 로그인까지 막힌다.
 * outcome 은 보안 기록용이다(성공·실패·잠김).
 */
export type PinOutcome = { kind: "success" | "failure" | "locked"; targetId: string | null };

export async function switchByPin(
  ctx: Ctx,
  userId: string,
  pin: string,
  db: Db = defaultDb,
  now: Date = new Date(),
  onOutcome?: (o: PinOutcome) => Promise<void>,
): Promise<{ userId: string; branchId: string }> {
  const report = async (o: PinOutcome) => {
    if (onOutcome) await onOutcome(o);
  };
  const [target] = await db
    .select({ id: users.id, pinHash: users.pinHash, active: users.active, role: memberships.role, failedPins: users.failedPins, pinLockedUntil: users.pinLockedUntil })
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
  if (target.pinLockedUntil && target.pinLockedUntil.getTime() > now.getTime()) {
    await report({ kind: "failure", targetId: target.id });
    throw new ValidationError(`PIN 오류가 반복되어 잠겼습니다. ${Math.ceil((target.pinLockedUntil.getTime() - now.getTime()) / 60_000)}분 뒤 다시 시도하세요`);
  }
  if (!(await verifyPassword(pin, target.pinHash))) {
    const failed = (target.pinLockedUntil ? 0 : target.failedPins) + 1;
    if (failed >= MAX_FAILED_LOGINS) {
      await db.update(users).set({ failedPins: 0, pinLockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) }).where(eq(users.id, target.id));
      await report({ kind: "locked", targetId: target.id });
      throw new ValidationError(`PIN ${MAX_FAILED_LOGINS}회 오류로 ${LOCK_MINUTES}분간 잠겼습니다`);
    }
    await db.update(users).set({ failedPins: failed, pinLockedUntil: null }).where(eq(users.id, target.id));
    await report({ kind: "failure", targetId: target.id });
    throw new ValidationError(`PIN이 올바르지 않습니다 (${MAX_FAILED_LOGINS - failed}회 남음)`);
  }
  if (target.failedPins > 0 || target.pinLockedUntil) await db.update(users).set({ failedPins: 0, pinLockedUntil: null }).where(eq(users.id, target.id));
  await report({ kind: "success", targetId: target.id });
  return { userId: target.id, branchId: ctx.branchId };
}
