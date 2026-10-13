import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { users } from "@/db/schema";
import type { Ctx } from "@/lib/auth/ctx";
import { hashPassword, validatePassword, verifyPassword } from "@/lib/auth/password";
import { ValidationError } from "@/lib/errors";
import { LOCK_MINUTES, MAX_FAILED_LOGINS } from "@/modules/auth/login";
import { recordSecurityEvent } from "./events";
import { createSession, revokeUserSessions, type SessionMeta } from "./sessions";

/**
 * 내 비밀번호 바꾸기. 지금 비밀번호를 확인한다(자리를 비운 사이 남이 바꾸지 못하게).
 * 틀리면 로그인 실패와 같은 횟수로 세서 잠근다. 바꾸고 나면 다른 기기는 모두 로그아웃되고,
 * 지금 기기에는 새 세션을 열어 돌려준다(이 기기는 계속 쓴다).
 */
export async function changeOwnPassword(ctx: Ctx, current: string, next: string, confirm: string, meta: SessionMeta, db: Db = defaultDb, now = new Date()): Promise<{ sessionId: string }> {
  const [u] = await db.select({ passwordHash: users.passwordHash, failedLogins: users.failedLogins, lockedUntil: users.lockedUntil }).from(users).where(eq(users.id, ctx.userId)).limit(1);
  if (!u) throw new ValidationError("계정을 찾을 수 없습니다");
  if (u.lockedUntil && u.lockedUntil.getTime() > now.getTime()) throw new ValidationError("비밀번호 오류가 반복되어 잠겼습니다. 잠시 뒤 다시 시도하세요");
  if (!(await verifyPassword(current, u.passwordHash))) {
    const failed = (u.lockedUntil ? 0 : u.failedLogins) + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await db.update(users).set(lock ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) } : { failedLogins: failed, lockedUntil: null }).where(eq(users.id, ctx.userId));
    await recordSecurityEvent({ kind: lock ? "login.locked" : "login.failure", userId: ctx.userId, ...meta, detail: { via: "password_change" } }, db);
    throw new ValidationError(lock ? `비밀번호 ${MAX_FAILED_LOGINS}회 오류로 ${LOCK_MINUTES}분간 잠겼습니다` : "지금 비밀번호가 맞지 않습니다");
  }
  const err = validatePassword(next);
  if (err) throw new ValidationError(err);
  if (next !== confirm) throw new ValidationError("새 비밀번호 확인이 일치하지 않습니다");
  if (next === current) throw new ValidationError("지금 비밀번호와 다른 비밀번호를 정하세요");

  return db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: await hashPassword(next), passwordChangedAt: now, failedLogins: 0, lockedUntil: null }).where(eq(users.id, ctx.userId));
    const revoked = await revokeUserSessions(ctx.userId, {}, tx, now);
    // 비밀번호 변경 시각 이후에 발급된 세션만 유효하다(buildCtx). 새 세션은 같은 초 안이어도 통과한다(초 단위 비교)
    const sessionId = await createSession(ctx.userId, "password", meta, tx, now);
    await recordSecurityEvent({ kind: "password.changed", userId: ctx.userId, actorId: ctx.userId, ...meta, detail: { by: "self", sessionsRevoked: Math.max(0, revoked - 1) } }, tx);
    return { sessionId };
  });
}

/** 지금 기기만 남기고 내 다른 로그인을 모두 끊는다 */
export async function logoutOtherDevices(ctx: Ctx, meta: SessionMeta, db: Db = defaultDb): Promise<number> {
  if (!ctx.sessionId) throw new ValidationError("로그인 세션을 확인할 수 없습니다. 다시 로그인하세요");
  const n = await revokeUserSessions(ctx.userId, { except: ctx.sessionId }, db);
  await recordSecurityEvent({ kind: "sessions.revoked", userId: ctx.userId, actorId: ctx.userId, ...meta, detail: { by: "self", count: n } }, db);
  return n;
}
