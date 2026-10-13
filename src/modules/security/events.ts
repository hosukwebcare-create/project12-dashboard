import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db as defaultDb, type Db, type Tx } from "@/db/client";
import { securityEvents, users, type SecurityEventKind } from "@/db/schema";
import { requireRole, type Ctx } from "@/lib/auth/ctx";

export type SecurityEventInput = {
  kind: SecurityEventKind;
  userId?: string | null;
  loginId?: string | null;
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detail?: Record<string, unknown> | null;
};

/**
 * 보안 기록 한 줄. 기록이 실패해도 로그인·로그아웃 자체를 막지 않는다(로그만 남긴다).
 * 아이디는 화면에 입력된 값이라 길이를 자른다. 비밀번호·PIN 은 받지도 않는다.
 */
export async function recordSecurityEvent(ev: SecurityEventInput, db: Db | Tx = defaultDb): Promise<void> {
  try {
    await db.insert(securityEvents).values({
      kind: ev.kind,
      userId: ev.userId ?? null,
      loginId: ev.loginId ? ev.loginId.slice(0, 60) : null,
      actorId: ev.actorId ?? null,
      ip: ev.ip ?? null,
      userAgent: ev.userAgent ?? null,
      detail: ev.detail ?? null,
    });
  } catch (e) {
    console.error("[security] 보안 기록 저장 실패", e instanceof Error ? e.message : e);
  }
}

export const SECURITY_EVENT_LABEL: Record<SecurityEventKind, string> = {
  "login.success": "로그인",
  "login.failure": "로그인 실패",
  "login.locked": "계정 잠김",
  "login.ip_blocked": "IP 차단",
  "pin.success": "PIN 전환",
  "pin.failure": "PIN 실패",
  "pin.locked": "PIN 잠김",
  logout: "로그아웃",
  "sessions.revoked": "강제 로그아웃",
  "password.changed": "비밀번호 변경",
};

/** 화면에서 눈에 띄게 표시할 종류 */
export const ALERT_KINDS: SecurityEventKind[] = ["login.failure", "login.locked", "login.ip_blocked", "pin.failure", "pin.locked"];

export type SecurityEventRow = {
  id: string;
  at: Date;
  kind: SecurityEventKind;
  loginId: string | null;
  userName: string | null;
  actorName: string | null;
  ip: string | null;
  userAgent: string | null;
  detail: Record<string, unknown> | null;
};

/** 본사 보안 기록 화면. 최근 것부터 */
export async function listSecurityEvents(ctx: Ctx, opts: { kinds?: SecurityEventKind[]; limit?: number } = {}, db: Db = defaultDb): Promise<SecurityEventRow[]> {
  requireRole(ctx, "hq_admin");
  const actor = sql<string | null>`(select name from ${users} a where a.id = ${securityEvents.actorId})`;
  const rows = await db
    .select({ id: securityEvents.id, at: securityEvents.at, kind: securityEvents.kind, loginId: securityEvents.loginId, userName: users.name, actorName: actor, ip: securityEvents.ip, userAgent: securityEvents.userAgent, detail: securityEvents.detail })
    .from(securityEvents)
    .leftJoin(users, eq(users.id, securityEvents.userId))
    .where(opts.kinds?.length ? inArray(securityEvents.kind, opts.kinds) : undefined)
    .orderBy(desc(securityEvents.at))
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 1000));
  return rows;
}

export type FailureHotspot = { key: string; failures: number; last: Date };

/** 최근 24시간 동안 실패가 몰린 IP·아이디. 무작위 대입 시도를 한눈에 보려고 */
export async function failureHotspots(ctx: Ctx, now = new Date(), db: Db = defaultDb): Promise<{ byIp: FailureHotspot[]; byLoginId: FailureHotspot[] }> {
  requireRole(ctx, "hq_admin");
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const where = and(inArray(securityEvents.kind, ["login.failure", "login.locked", "pin.failure", "pin.locked"]), gte(securityEvents.at, since));
  const group = async (col: typeof securityEvents.ip | typeof securityEvents.loginId) =>
    (
      await db
        .select({ key: col, failures: sql<number>`count(*)::int`, last: sql<Date>`max(${securityEvents.at})` })
        .from(securityEvents)
        .where(and(where, sql`${col} is not null`))
        .groupBy(col)
        .orderBy(desc(sql`count(*)`))
        .limit(10)
    ).map((r) => ({ key: r.key ?? "", failures: r.failures, last: new Date(r.last) }));
  const [byIp, byLoginId] = await Promise.all([group(securityEvents.ip), group(securityEvents.loginId)]);
  return { byIp, byLoginId };
}

/** 보관 기간이 지난 보안 기록을 지운다 (보관 배치) */
export async function purgeSecurityEvents(retentionDays = 365, now = new Date(), db: Db = defaultDb): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60_000);
  const rows = await db.delete(securityEvents).where(lt(securityEvents.at, cutoff)).returning({ id: securityEvents.id });
  return rows.length;
}
