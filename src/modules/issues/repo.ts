import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as defaultDb, type Db, type Tx } from "@/db/client";
import { issueComments, issues, members, memberships, users, type IssueStatus } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { ALL_ROLES, MANAGER_ROLES, requireRole, type Ctx } from "@/lib/auth/ctx";
import { NotFoundError } from "@/lib/errors";
import { notify } from "@/modules/notifications/repo";
import { enqueueEvent } from "@/modules/outbox/repo";

export type IssueInput = {
  memberId: string | null;
  title: string;
  body: string | null;
  severity: "low" | "normal" | "high";
  source: "rounding" | "counsel" | "manual";
  checkId?: string | null;
};

export type IssueRow = typeof issues.$inferSelect & {
  memberName: string | null;
  reporterName: string | null;
  assigneeName: string | null;
};

export type IssueDetail = IssueRow & {
  comments: { id: string; authorId: string; authorName: string | null; body: string; createdAt: Date }[];
};

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = { open: "접수", in_progress: "처리 중", resolved: "해결" };
export const SEVERITY_LABEL: Record<string, string> = { low: "낮음", normal: "보통", high: "높음" };

export async function branchManagerIds(branchId: string, db: Db | Tx): Promise<string[]> {
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.branchId, branchId), eq(memberships.role, "branch_manager"), eq(users.active, true)));
  return rows.map((r) => r.userId);
}

export async function createIssue(ctx: Ctx, input: IssueInput, db: Db | Tx = defaultDb): Promise<string> {
  requireRole(ctx, ...ALL_ROLES);
  if (input.memberId) {
    const [m] = await db.select({ id: members.id }).from(members).where(and(eq(members.id, input.memberId), eq(members.branchId, ctx.branchId))).limit(1);
    if (!m) throw new NotFoundError("회원을 찾을 수 없습니다");
  }
  const [row] = await db
    .insert(issues)
    .values({
      branchId: ctx.branchId,
      memberId: input.memberId,
      source: input.source,
      checkId: input.checkId ?? null,
      title: input.title,
      body: input.body,
      severity: input.severity,
      reportedBy: ctx.userId,
    })
    .returning({ id: issues.id });
  const managers = (await branchManagerIds(ctx.branchId, db)).filter((id) => id !== ctx.userId);
  await notify(db, managers, "issue", { issueId: row.id, title: input.title }, ctx.branchId);
  await enqueueEvent(db, ctx.branchId, "issue.created", { issueId: row.id, title: input.title, severity: input.severity, reportedBy: ctx.userName }, `[이슈 보고] ${input.title}${input.body ? ` · ${input.body}` : ""} (보고: ${ctx.userName})`);
  return row.id;
}

const reporter = alias(users, "reporter");
const assignee = alias(users, "assignee");

function baseSelect(db: Db | Tx) {
  return db
    .select({
      i: issues,
      memberName: members.name,
      reporterName: reporter.name,
      assigneeName: assignee.name,
    })
    .from(issues)
    .leftJoin(members, eq(members.id, issues.memberId))
    .leftJoin(reporter, eq(reporter.id, issues.reportedBy))
    .leftJoin(assignee, eq(assignee.id, issues.assignedTo));
}

function flatten(r: { i: typeof issues.$inferSelect; memberName: string | null; reporterName: string | null; assigneeName: string | null }): IssueRow {
  return { ...r.i, memberName: r.memberName, reporterName: r.reporterName, assigneeName: r.assigneeName };
}

export async function listIssues(ctx: Ctx, status?: IssueStatus, db: Db = defaultDb): Promise<IssueRow[]> {
  const conds = [eq(issues.branchId, ctx.branchId)];
  if (status) conds.push(eq(issues.status, status));
  const rows = await baseSelect(db).where(and(...conds)).orderBy(desc(issues.createdAt));
  return rows.map(flatten);
}

export async function getIssue(ctx: Ctx, id: string, db: Db = defaultDb): Promise<IssueDetail> {
  const [row] = await baseSelect(db).where(and(eq(issues.id, id), eq(issues.branchId, ctx.branchId))).limit(1);
  if (!row) throw new NotFoundError("이슈를 찾을 수 없습니다");
  const comments = await db
    .select({ id: issueComments.id, authorId: issueComments.authorId, authorName: users.name, body: issueComments.body, createdAt: issueComments.createdAt })
    .from(issueComments)
    .leftJoin(users, eq(users.id, issueComments.authorId))
    .where(eq(issueComments.issueId, id))
    .orderBy(asc(issueComments.createdAt));
  return { ...flatten(row), comments };
}

export async function updateIssue(ctx: Ctx, id: string, patch: { status?: IssueStatus; assignedTo?: string | null }, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...MANAGER_ROLES);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(issues).where(and(eq(issues.id, id), eq(issues.branchId, ctx.branchId))).limit(1);
    if (!before) throw new NotFoundError("이슈를 찾을 수 없습니다");
    const set: Partial<typeof issues.$inferInsert> = {};
    if (patch.status) {
      set.status = patch.status;
      set.resolvedAt = patch.status === "resolved" ? new Date() : null;
    }
    if (patch.assignedTo !== undefined) set.assignedTo = patch.assignedTo;
    await tx.update(issues).set(set).where(eq(issues.id, id));
    await writeAudit(tx, ctx, "issue", id, "update", { status: before.status, assignedTo: before.assignedTo }, set);
    if (patch.status && patch.status !== before.status && before.reportedBy && before.reportedBy !== ctx.userId) {
      await notify(tx, [before.reportedBy], "issue_status", { issueId: id, title: before.title, status: patch.status }, ctx.branchId);
    }
  });
}

export async function addIssueComment(ctx: Ctx, id: string, body: string, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...ALL_ROLES);
  const text = body.trim();
  if (!text) return;
  await db.transaction(async (tx) => {
    const [issue] = await tx.select().from(issues).where(and(eq(issues.id, id), eq(issues.branchId, ctx.branchId))).limit(1);
    if (!issue) throw new NotFoundError("이슈를 찾을 수 없습니다");
    const prev = await tx.select({ authorId: issueComments.authorId }).from(issueComments).where(eq(issueComments.issueId, id));
    await tx.insert(issueComments).values({ issueId: id, authorId: ctx.userId, body: text });
    const recipients = new Set<string>([...prev.map((p) => p.authorId), issue.reportedBy ?? "", issue.assignedTo ?? ""].filter(Boolean));
    recipients.delete(ctx.userId);
    await notify(tx, [...recipients], "issue_comment", { issueId: id, title: issue.title }, ctx.branchId);
  });
}

export async function countOpenIssues(ctx: Ctx, db: Db = defaultDb): Promise<number> {
  const [r] = await db.select({ n: count() }).from(issues).where(and(eq(issues.branchId, ctx.branchId), inArray(issues.status, ["open", "in_progress"])));
  return Number(r?.n ?? 0);
}
