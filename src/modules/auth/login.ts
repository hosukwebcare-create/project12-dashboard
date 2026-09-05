import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 10;

export type AuthResult = { ok: true; userId: string } | { ok: false; reason: "invalid"; remaining?: number } | { ok: false; reason: "locked"; until: Date };

/**
 * 아이디·비밀번호 검증 + 실패 잠금.
 * 없는 아이디·비활성 사용자·틀린 비밀번호는 모두 같은 'invalid' 로 답해 계정 존재 여부를 노출하지 않는다.
 */
export async function authenticate(loginId: string, password: string, now: Date = new Date(), db: Db = defaultDb): Promise<AuthResult> {
  const [user] = await db.select().from(users).where(eq(users.loginId, loginId.trim())).limit(1);
  if (!user || !user.active) {
    await verifyPassword(password, "$2a$10$abcdefghijklmnopqrstuuJ0d2Q1nL9O2Tq3o2v8v4S6xYq0y6bWm"); // 타이밍 균등화
    return { ok: false, reason: "invalid" };
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    return { ok: false, reason: "locked", until: user.lockedUntil };
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (ok) {
    if (user.failedLogins > 0 || user.lockedUntil) await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
    return { ok: true, userId: user.id };
  }
  const failed = (user.lockedUntil ? 0 : user.failedLogins) + 1;
  if (failed >= MAX_FAILED_LOGINS) {
    const until = new Date(now.getTime() + LOCK_MINUTES * 60_000);
    await db.update(users).set({ failedLogins: 0, lockedUntil: until }).where(eq(users.id, user.id));
    return { ok: false, reason: "locked", until };
  }
  await db.update(users).set({ failedLogins: failed, lockedUntil: null }).where(eq(users.id, user.id));
  return { ok: false, reason: "invalid", remaining: MAX_FAILED_LOGINS - failed };
}
