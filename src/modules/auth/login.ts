import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 10;

/** userId 는 보안 기록용이다(계정이 있을 때만). 화면에는 계정 존재 여부를 드러내지 않는다 */
export type AuthResult = { ok: true; userId: string } | { ok: false; reason: "invalid"; remaining?: number; userId?: string } | { ok: false; reason: "locked"; until: Date; userId: string; justLocked: boolean };

/** 없는 아이디에도 같은 비용의 bcrypt 비교를 하려고 쓰는 해시. 비용을 올리면 따라 올라가도록 처음 쓸 때 만든다 */
let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword("timing-equalizer-not-a-password"));

/**
 * 아이디·비밀번호 검증 + 실패 잠금.
 * 없는 아이디·비활성 사용자·틀린 비밀번호는 모두 같은 'invalid' 로 답해 계정 존재 여부를 노출하지 않는다.
 */
export async function authenticate(loginId: string, password: string, now: Date = new Date(), db: Db = defaultDb): Promise<AuthResult> {
  const [user] = await db.select().from(users).where(eq(users.loginId, loginId.trim())).limit(1);
  if (!user || !user.active) {
    await verifyPassword(password, await dummyHash()); // 타이밍 균등화
    return { ok: false, reason: "invalid" };
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    return { ok: false, reason: "locked", until: user.lockedUntil, userId: user.id, justLocked: false };
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (ok) {
    const set: Partial<typeof users.$inferInsert> = {};
    if (user.failedLogins > 0 || user.lockedUntil) Object.assign(set, { failedLogins: 0, lockedUntil: null });
    // 해시 강도를 올린 뒤 처음 로그인하면 새 기준으로 다시 저장한다 (같은 비밀번호라 passwordChangedAt 은 그대로)
    if (needsRehash(user.passwordHash)) set.passwordHash = await hashPassword(password);
    if (Object.keys(set).length > 0) await db.update(users).set(set).where(eq(users.id, user.id));
    return { ok: true, userId: user.id };
  }
  const failed = (user.lockedUntil ? 0 : user.failedLogins) + 1;
  if (failed >= MAX_FAILED_LOGINS) {
    const until = new Date(now.getTime() + LOCK_MINUTES * 60_000);
    await db.update(users).set({ failedLogins: 0, lockedUntil: until }).where(eq(users.id, user.id));
    return { ok: false, reason: "locked", until, userId: user.id, justLocked: true };
  }
  await db.update(users).set({ failedLogins: failed, lockedUntil: null }).where(eq(users.id, user.id));
  return { ok: false, reason: "invalid", remaining: MAX_FAILED_LOGINS - failed, userId: user.id };
}
