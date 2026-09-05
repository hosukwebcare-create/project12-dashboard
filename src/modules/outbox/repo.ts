import { and, asc, eq, ne } from "drizzle-orm";
import { db as defaultDb, type Db, type Tx } from "@/db/client";
import { eventOutbox, webhookEndpoints } from "@/db/schema";
import { MANAGER_ROLES, requireRole, type Ctx } from "@/lib/auth/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertResolvesSafe, assertSafeWebhookUrl } from "@/lib/net";

export const OUTBOX_EVENTS = [
  { key: "issue.created", label: "이슈 보고" },
  { key: "penalty.high", label: "고벌점 (5점 이상)" },
  { key: "session.completed", label: "라운딩 회차 완료" },
] as const;
export type OutboxEventType = (typeof OUTBOX_EVENTS)[number]["key"];
export const HIGH_PENALTY_THRESHOLD = 5;

export type WebhookInput = { id?: string; name: string; url: string; events: string[]; active: boolean };
export type WebhookRow = typeof webhookEndpoints.$inferSelect;

export async function listWebhookEndpoints(ctx: Ctx, db: Db = defaultDb): Promise<WebhookRow[]> {
  requireRole(ctx, ...MANAGER_ROLES);
  return db.select().from(webhookEndpoints).where(eq(webhookEndpoints.branchId, ctx.branchId)).orderBy(asc(webhookEndpoints.name));
}

export async function upsertWebhookEndpoint(ctx: Ctx, input: WebhookInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...MANAGER_ROLES);
  if (!input.name.trim()) throw new ValidationError("이름을 입력하세요");
  const url = assertSafeWebhookUrl(input.url);
  await assertResolvesSafe(url);
  const events = input.events.filter((e) => OUTBOX_EVENTS.some((x) => x.key === e));
  const vals = { name: input.name.trim(), url: url.toString(), events, active: input.active };
  if (input.id) {
    const [existing] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, input.id), eq(webhookEndpoints.branchId, ctx.branchId))).limit(1);
    if (!existing) throw new NotFoundError("웹훅을 찾을 수 없습니다");
    await db.update(webhookEndpoints).set(vals).where(eq(webhookEndpoints.id, input.id));
    return input.id;
  }
  const [row] = await db.insert(webhookEndpoints).values({ ...vals, branchId: ctx.branchId }).returning({ id: webhookEndpoints.id });
  return row.id;
}

/** 지점에 이 이벤트를 받는 활성 웹훅이 있을 때만 이벤트를 쌓는다 */
export async function enqueueEvent(tx: Db | Tx, branchId: string, type: OutboxEventType, payload: Record<string, unknown>, text: string): Promise<boolean> {
  const endpoints = await tx.select({ events: webhookEndpoints.events }).from(webhookEndpoints).where(and(eq(webhookEndpoints.branchId, branchId), eq(webhookEndpoints.active, true)));
  if (!endpoints.some((e) => e.events.includes(type))) return false;
  await tx.insert(eventOutbox).values({ branchId, type, payload, text });
  return true;
}

export type Sender = (url: string, body: string) => Promise<{ ok: boolean; status: number }>;

export const fetchSender: Sender = async (url, body) => {
  // 저장 시점 검증과 별개로, DNS 리바인딩에 대비해 전송 직전에도 해석 결과를 확인한다
  await assertResolvesSafe(new URL(url));
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(10_000) });
  return { ok: res.ok, status: res.status };
};

/** 대기 이벤트를 구독 웹훅으로 전송한다. Slack/Mattermost/Rocket.Chat 인커밍 웹훅과 호환되는 { text } JSON */
export async function dispatchOutbox(sender: Sender = fetchSender, limit = 50, db: Db = defaultDb): Promise<{ sent: number; failed: number }> {
  const pending = await db.select().from(eventOutbox).where(eq(eventOutbox.status, "pending")).orderBy(asc(eventOutbox.createdAt)).limit(limit);
  let sent = 0;
  let failed = 0;
  for (const ev of pending) {
    const endpoints = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.branchId, ev.branchId), eq(webhookEndpoints.active, true)));
    const targets = endpoints.filter((e) => e.events.includes(ev.type));
    const body = JSON.stringify({ text: ev.text, event: ev.type, ...ev.payload });
    let allOk = true;
    let lastError: string | null = null;
    for (const t of targets) {
      try {
        const r = await sender(t.url, body);
        if (!r.ok) {
          allOk = false;
          lastError = `${t.name}: HTTP ${r.status}`;
        }
      } catch (e) {
        allOk = false;
        lastError = `${t.name}: ${e instanceof Error ? e.message : "오류"}`;
      }
    }
    if (allOk) {
      sent++;
      await db.update(eventOutbox).set({ status: "sent", sentAt: new Date(), attempts: ev.attempts + 1, lastError: null }).where(eq(eventOutbox.id, ev.id));
    } else {
      failed++;
      await db.update(eventOutbox).set({ status: "failed", attempts: ev.attempts + 1, lastError }).where(eq(eventOutbox.id, ev.id));
    }
  }
  return { sent, failed };
}

export async function retryFailedEvents(ctx: Ctx, db: Db = defaultDb): Promise<number> {
  requireRole(ctx, ...MANAGER_ROLES);
  const rows = await db
    .update(eventOutbox)
    .set({ status: "pending" })
    .where(and(eq(eventOutbox.branchId, ctx.branchId), eq(eventOutbox.status, "failed"), ne(eventOutbox.attempts, 99)))
    .returning({ id: eventOutbox.id });
  return rows.length;
}

export async function recentEvents(ctx: Ctx, db: Db = defaultDb) {
  requireRole(ctx, ...MANAGER_ROLES);
  return db.select().from(eventOutbox).where(eq(eventOutbox.branchId, ctx.branchId)).orderBy(asc(eventOutbox.status), asc(eventOutbox.createdAt)).limit(50);
}
