import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { alimtalkMessages, alimtalkTemplates, memberGuardians, members, seats, type MessageStatus } from "@/db/schema";
import { MANAGER_ROLES, requireRole, type Ctx } from "@/lib/auth/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { extractVariables, renderTemplate } from "@/lib/rules/template";
import type { AlimtalkProvider } from "./provider";

export type Template = typeof alimtalkTemplates.$inferSelect;
export type TemplateInput = { id?: string; code: string; name: string; body: string; active: boolean };

export async function listTemplates(ctx: Ctx, db: Db = defaultDb, includeInactive = false): Promise<Template[]> {
  requireRole(ctx, ...MANAGER_ROLES);
  const conds = includeInactive ? [] : [eq(alimtalkTemplates.active, true)];
  return db.select().from(alimtalkTemplates).where(conds.length ? and(...conds) : undefined).orderBy(asc(alimtalkTemplates.name));
}

export async function upsertTemplate(ctx: Ctx, input: TemplateInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, "hq_admin");
  const code = input.code.trim();
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(code)) throw new ValidationError("템플릿 코드는 영문·숫자 2~40자 (카카오 비즈메시지에 등록한 코드)");
  if (!input.name.trim()) throw new ValidationError("템플릿 이름을 입력하세요");
  if (!input.body.trim()) throw new ValidationError("본문을 입력하세요");
  const conds = [eq(alimtalkTemplates.code, code)];
  if (input.id) conds.push(ne(alimtalkTemplates.id, input.id));
  const [dup] = await db.select({ id: alimtalkTemplates.id }).from(alimtalkTemplates).where(and(...conds)).limit(1);
  if (dup) throw new ValidationError("같은 코드의 템플릿이 있습니다");
  const vals = { code, name: input.name.trim(), body: input.body, variables: extractVariables(input.body), active: input.active };
  if (input.id) {
    await db.update(alimtalkTemplates).set(vals).where(eq(alimtalkTemplates.id, input.id));
    return input.id;
  }
  const [row] = await db.insert(alimtalkTemplates).values(vals).returning({ id: alimtalkTemplates.id });
  return row.id;
}

export type RecipientType = "member" | "guardian";
export type RecipientQuery = { group: "all" | "focus" | "members"; memberIds?: string[]; recipientType: RecipientType };
export type Recipient = { memberId: string; name: string; seatNo: number | null; recipientType: RecipientType; recipientName: string | null; phone: string | null; vars: Record<string, string> };

export async function buildRecipients(ctx: Ctx, q: RecipientQuery, db: Db = defaultDb): Promise<Recipient[]> {
  requireRole(ctx, ...MANAGER_ROLES);
  const conds = [eq(members.branchId, ctx.branchId), inArray(members.status, ["enrolled", "paused"])];
  if (q.group === "focus") conds.push(eq(members.focusCare, true));
  if (q.group === "members") {
    if (!q.memberIds?.length) return [];
    conds.push(inArray(members.id, q.memberIds));
  }
  const rows = await db
    .select({ id: members.id, name: members.name, phone: members.phone, seatNo: seats.seatNo, gName: memberGuardians.name, gPhone: memberGuardians.phone })
    .from(members)
    .leftJoin(seats, eq(seats.id, members.seatId))
    .leftJoin(memberGuardians, and(eq(memberGuardians.memberId, members.id), eq(memberGuardians.primaryContact, true)))
    .where(and(...conds))
    .orderBy(sql`${seats.seatNo} asc nulls last`, asc(members.name));
  const seen = new Set<string>();
  return rows
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => ({
      memberId: r.id,
      name: r.name,
      seatNo: r.seatNo,
      recipientType: q.recipientType,
      recipientName: q.recipientType === "guardian" ? (r.gName ?? null) : r.name,
      phone: q.recipientType === "guardian" ? (r.gPhone ?? null) : (r.phone ?? null),
      vars: { 이름: r.name, 지점: ctx.branchName, 좌석: r.seatNo ? String(r.seatNo) : "" },
    }));
}

export async function queueMessages(ctx: Ctx, input: { templateId: string; recipients: Recipient[]; extraVars: Record<string, string> }, db: Db = defaultDb): Promise<{ batchId: string; queued: number; skipped: number }> {
  requireRole(ctx, ...MANAGER_ROLES);
  const [tpl] = await db.select().from(alimtalkTemplates).where(and(eq(alimtalkTemplates.id, input.templateId), eq(alimtalkTemplates.active, true))).limit(1);
  if (!tpl) throw new NotFoundError("템플릿을 찾을 수 없습니다");
  const batchId = randomUUID();
  const values = input.recipients
    .filter((r) => r.phone)
    .map((r) => {
      const vars = { ...r.vars, ...input.extraVars };
      return {
        branchId: ctx.branchId,
        templateId: tpl.id,
        memberId: r.memberId,
        recipientType: r.recipientType,
        recipientPhone: r.phone!,
        recipientName: r.recipientName,
        variables: vars,
        renderedText: renderTemplate(tpl.body, vars),
        batchId,
        createdBy: ctx.userId,
      };
    });
  if (values.length) await db.insert(alimtalkMessages).values(values);
  return { batchId, queued: values.length, skipped: input.recipients.length - values.length };
}

/** 큐에 쌓인 메시지를 공급자로 보낸다 (배치·재시도용). 지점과 무관하게 처리한다 */
export async function processQueue(provider: AlimtalkProvider, limit = 100, db: Db = defaultDb): Promise<{ sent: number; failed: number }> {
  const queued = await db
    .select({ m: alimtalkMessages, code: alimtalkTemplates.code })
    .from(alimtalkMessages)
    .leftJoin(alimtalkTemplates, eq(alimtalkTemplates.id, alimtalkMessages.templateId))
    .where(eq(alimtalkMessages.status, "queued"))
    .orderBy(asc(alimtalkMessages.createdAt))
    .limit(limit);
  let sent = 0;
  let failed = 0;
  for (const { m, code } of queued) {
    const res = await provider.send({ to: m.recipientPhone, text: m.renderedText, templateCode: code ?? null, variables: m.variables });
    if (res.ok) {
      sent++;
      await db.update(alimtalkMessages).set({ status: "sent", providerMessageId: res.providerMessageId, sentAt: new Date(), attempts: m.attempts + 1, error: null }).where(eq(alimtalkMessages.id, m.id));
    } else {
      failed++;
      await db.update(alimtalkMessages).set({ status: "failed", error: res.error, attempts: m.attempts + 1 }).where(eq(alimtalkMessages.id, m.id));
    }
  }
  return { sent, failed };
}

export type MessageRow = typeof alimtalkMessages.$inferSelect & { templateName: string | null; memberName: string | null };

export async function listMessages(ctx: Ctx, opts: { status?: MessageStatus; batchId?: string; limit?: number } = {}, db: Db = defaultDb): Promise<MessageRow[]> {
  requireRole(ctx, ...MANAGER_ROLES);
  const conds = [eq(alimtalkMessages.branchId, ctx.branchId)];
  if (opts.status) conds.push(eq(alimtalkMessages.status, opts.status));
  if (opts.batchId) conds.push(eq(alimtalkMessages.batchId, opts.batchId));
  const rows = await db
    .select({ m: alimtalkMessages, templateName: alimtalkTemplates.name, memberName: members.name })
    .from(alimtalkMessages)
    .leftJoin(alimtalkTemplates, eq(alimtalkTemplates.id, alimtalkMessages.templateId))
    .leftJoin(members, eq(members.id, alimtalkMessages.memberId))
    .where(and(...conds))
    .orderBy(desc(alimtalkMessages.createdAt))
    .limit(opts.limit ?? 200);
  return rows.map((r) => ({ ...r.m, templateName: r.templateName, memberName: r.memberName }));
}

export async function retryFailed(ctx: Ctx, batchId: string, db: Db = defaultDb): Promise<number> {
  requireRole(ctx, ...MANAGER_ROLES);
  const rows = await db
    .update(alimtalkMessages)
    .set({ status: "queued", error: null })
    .where(and(eq(alimtalkMessages.branchId, ctx.branchId), eq(alimtalkMessages.batchId, batchId), eq(alimtalkMessages.status, "failed")))
    .returning({ id: alimtalkMessages.id });
  return rows.length;
}
