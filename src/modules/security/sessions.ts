import { and, desc, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import { db as defaultDb, type Db, type Tx } from "@/db/client";
import { authSessions, type SessionMethod } from "@/db/schema";
import { sessionCookie } from "@/lib/auth/session";

/** '마지막 사용' 갱신 간격. 요청마다 쓰지 않게 몇 분에 한 번만 */
const TOUCH_INTERVAL_MS = 5 * 60_000;

export type SessionMeta = { ip: string | null; userAgent: string | null };

/** 로그인(비밀번호·PIN)마다 세션 하나 */
export async function createSession(userId: string, method: SessionMethod, meta: SessionMeta & { branchId?: string | null }, db: Db | Tx = defaultDb, now = new Date()): Promise<string> {
  const [row] = await db
    .insert(authSessions)
    .values({ userId, method, branchId: meta.branchId ?? null, ip: meta.ip, userAgent: meta.userAgent, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + sessionCookie.ttlSeconds * 1000) })
    .returning({ id: authSessions.id });
  return row.id;
}

/**
 * 쿠키의 세션이 아직 살아 있는가(이 사용자 것, 폐기 안 됨, 만료 안 됨). 살아 있으면 묶인 지점(PIN 세션)을 돌려주고,
 * 가끔 '마지막 사용'을 갱신한다. 세션 번호가 UUID 모양이 아니면 DB 에 묻지 않는다.
 */
export async function activeSession(sessionId: string, userId: string, db: Db = defaultDb, now = new Date()): Promise<{ branchId: string | null; method: SessionMethod } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const [s] = await db
    .select({ lastSeenAt: authSessions.lastSeenAt, branchId: authSessions.branchId, method: authSessions.method })
    .from(authSessions)
    .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, now)))
    .limit(1);
  if (!s) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, sessionId));
  }
  return { branchId: s.branchId, method: s.method };
}

export async function revokeSession(sessionId: string, db: Db | Tx = defaultDb, now = new Date()): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return;
  await db.update(authSessions).set({ revokedAt: now }).where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)));
}

/** 그 사람의 세션을 모두(또는 지금 쓰는 것 하나만 빼고) 끊는다. 끊은 개수를 돌려준다 */
export async function revokeUserSessions(userId: string, opts: { except?: string } = {}, db: Db | Tx = defaultDb, now = new Date()): Promise<number> {
  const conds = [eq(authSessions.userId, userId), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, now)];
  if (opts.except) conds.push(ne(authSessions.id, opts.except));
  const rows = await db.update(authSessions).set({ revokedAt: now }).where(and(...conds)).returning({ id: authSessions.id });
  return rows.length;
}

export type SessionRow = { id: string; method: SessionMethod; ip: string | null; userAgent: string | null; createdAt: Date; lastSeenAt: Date; current: boolean };

/** 지금 로그인돼 있는 기기 목록 (내 계정 화면) */
export async function listActiveSessions(userId: string, currentId: string | null, db: Db = defaultDb, now = new Date()): Promise<SessionRow[]> {
  const rows = await db
    .select({ id: authSessions.id, method: authSessions.method, ip: authSessions.ip, userAgent: authSessions.userAgent, createdAt: authSessions.createdAt, lastSeenAt: authSessions.lastSeenAt })
    .from(authSessions)
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, now)))
    .orderBy(desc(authSessions.lastSeenAt));
  return rows.map((r) => ({ ...r, current: r.id === currentId }));
}

/** 만료·폐기된 지 30일이 지난 세션 행을 지운다 (보관 배치) */
export async function purgeOldSessions(now = new Date(), db: Db = defaultDb): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  const rows = await db
    .delete(authSessions)
    .where(or(lt(authSessions.expiresAt, cutoff), lt(authSessions.revokedAt, cutoff)))
    .returning({ id: authSessions.id });
  return rows.length;
}
