import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as defaultDb, type Db, type Tx } from "@/db/client";
import { counselComments, counselLogs, members, memberships, seats, users, type CounselLogType } from "@/db/schema";
import { requireRole, STAFF_ROLES, type Ctx } from "@/lib/auth/ctx";
import { writeAudit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { toDate } from "@/lib/rules/week";
import { notify } from "@/modules/notifications/repo";

export type CounselCell = {
  logId: string;
  issueText: string | null;
  issueByName: string | null;
  issueAt: Date | null;
  resolutionText: string | null;
  resolutionByName: string | null;
  resolutionAt: Date | null;
  commentCount: number;
};

export type GridMember = { id: string; name: string; seatNo: number | null; school: string | null; grade: string | null; focusCare: boolean };

export type LogInput = {
  memberId: string;
  logType: CounselLogType;
  periodDate: string;
  field: "issue" | "resolution";
  text: string;
};

export type CounselLogDetail = typeof counselLogs.$inferSelect & {
  memberName: string;
  seatNo: number | null;
  issueByName: string | null;
  resolutionByName: string | null;
  comments: { id: string; authorId: string; authorName: string | null; body: string; createdAt: Date }[];
};

const issueUser = alias(users, "issue_user");
const resolutionUser = alias(users, "resolution_user");

async function assertMemberInBranch(ctx: Ctx, memberId: string, db: Db | Tx) {
  const [m] = await db.select({ id: members.id }).from(members).where(and(eq(members.id, memberId), eq(members.branchId, ctx.branchId))).limit(1);
  if (!m) throw new NotFoundError("회원을 찾을 수 없습니다");
}

async function commentCounts(logIds: string[], db: Db | Tx): Promise<Map<string, number>> {
  if (logIds.length === 0) return new Map();
  const rows = await db
    .select({ logId: counselComments.logId, n: count() })
    .from(counselComments)
    .where(inArray(counselComments.logId, logIds))
    .groupBy(counselComments.logId);
  return new Map(rows.map((r) => [r.logId, Number(r.n)]));
}

function selectLogs(db: Db | Tx) {
  return db
    .select({ l: counselLogs, issueByName: issueUser.name, resolutionByName: resolutionUser.name })
    .from(counselLogs)
    .leftJoin(issueUser, eq(issueUser.id, counselLogs.issueBy))
    .leftJoin(resolutionUser, eq(resolutionUser.id, counselLogs.resolutionBy));
}

export async function gridMembers(ctx: Ctx, onlyFocus = false, db: Db = defaultDb): Promise<GridMember[]> {
  const conds = [eq(members.branchId, ctx.branchId), inArray(members.status, ["enrolled", "paused"])];
  if (onlyFocus) conds.push(eq(members.focusCare, true));
  return db
    .select({ id: members.id, name: members.name, seatNo: seats.seatNo, school: members.school, grade: members.grade, focusCare: members.focusCare })
    .from(members)
    .leftJoin(seats, eq(seats.id, members.seatId))
    .where(and(...conds))
    .orderBy(sql`${seats.seatNo} asc nulls last`, asc(members.name));
}

export async function weeklyGrid(ctx: Ctx, weekStarts: string[], db: Db = defaultDb): Promise<{ members: GridMember[]; cells: Record<string, CounselCell> }> {
  requireRole(ctx, ...STAFF_ROLES);
  const list = await gridMembers(ctx, false, db);
  const cells: Record<string, CounselCell> = {};
  if (weekStarts.length === 0) return { members: list, cells };
  const logs = await selectLogs(db).where(
    and(eq(counselLogs.branchId, ctx.branchId), eq(counselLogs.logType, "weekly"), inArray(counselLogs.periodDate, weekStarts)),
  );
  const counts = await commentCounts(logs.map((x) => x.l.id), db);
  for (const { l, issueByName, resolutionByName } of logs) {
    cells[`${l.memberId}|${l.periodDate}`] = {
      logId: l.id,
      issueText: l.issueText,
      issueByName,
      issueAt: l.issueAt,
      resolutionText: l.resolutionText,
      resolutionByName,
      resolutionAt: l.resolutionAt,
      commentCount: counts.get(l.id) ?? 0,
    };
  }
  return { members: list, cells };
}

export async function focusDailyGrid(ctx: Ctx, memberId: string, dates: string[], db: Db = defaultDb): Promise<Record<string, CounselCell>> {
  requireRole(ctx, ...STAFF_ROLES);
  await assertMemberInBranch(ctx, memberId, db);
  const cells: Record<string, CounselCell> = {};
  if (dates.length === 0) return cells;
  const logs = await selectLogs(db).where(
    and(eq(counselLogs.memberId, memberId), eq(counselLogs.logType, "focus_daily"), inArray(counselLogs.periodDate, dates)),
  );
  const counts = await commentCounts(logs.map((x) => x.l.id), db);
  for (const { l, issueByName, resolutionByName } of logs) {
    cells[l.periodDate] = {
      logId: l.id,
      issueText: l.issueText,
      issueByName,
      issueAt: l.issueAt,
      resolutionText: l.resolutionText,
      resolutionByName,
      resolutionAt: l.resolutionAt,
      commentCount: counts.get(l.id) ?? 0,
    };
  }
  return cells;
}

export async function upsertLog(ctx: Ctx, input: LogInput, db: Db = defaultDb): Promise<string> {
  if (input.field === "issue") requireRole(ctx, "hq_admin", "branch_manager");
  else requireRole(ctx, "hq_admin", "mentor");
  if (input.logType === "weekly" && toDate(input.periodDate).getDay() !== 1) {
    throw new ValidationError("주간 일지는 월요일 날짜만 받습니다");
  }
  await assertMemberInBranch(ctx, input.memberId, db);
  const now = new Date();
  const fieldSet =
    input.field === "issue"
      ? { issueText: input.text, issueBy: ctx.userId, issueAt: now }
      : { resolutionText: input.text, resolutionBy: ctx.userId, resolutionAt: now };
  const [existing] = await db
    .select({ id: counselLogs.id, issueText: counselLogs.issueText, resolutionText: counselLogs.resolutionText })
    .from(counselLogs)
    .where(and(eq(counselLogs.memberId, input.memberId), eq(counselLogs.logType, input.logType), eq(counselLogs.periodDate, input.periodDate)))
    .limit(1);
  const [row] = await db
    .insert(counselLogs)
    .values({ branchId: ctx.branchId, memberId: input.memberId, logType: input.logType, periodDate: input.periodDate, ...fieldSet })
    .onConflictDoUpdate({ target: [counselLogs.memberId, counselLogs.logType, counselLogs.periodDate], set: { ...fieldSet, updatedAt: now } })
    .returning({ id: counselLogs.id });
  // 이미 쓴 내용을 덮어쓰면 이전 본문을 감사 로그에 남긴다 (처음 작성은 기록 자체가 이력)
  const beforeText = existing ? (input.field === "issue" ? existing.issueText : existing.resolutionText) : null;
  if (existing && beforeText !== null && beforeText !== input.text) {
    await writeAudit(db, ctx, "counsel_log", row.id, "update", { field: input.field, text: beforeText }, { field: input.field, text: input.text });
  }
  return row.id;
}

export async function getLog(ctx: Ctx, logId: string, db: Db = defaultDb): Promise<CounselLogDetail> {
  requireRole(ctx, ...STAFF_ROLES);
  const [row] = await selectLogs(db).where(and(eq(counselLogs.id, logId), eq(counselLogs.branchId, ctx.branchId))).limit(1);
  if (!row) throw new NotFoundError("일지를 찾을 수 없습니다");
  const [m] = await db
    .select({ name: members.name, seatNo: seats.seatNo })
    .from(members)
    .leftJoin(seats, eq(seats.id, members.seatId))
    .where(eq(members.id, row.l.memberId))
    .limit(1);
  const comments = await db
    .select({ id: counselComments.id, authorId: counselComments.authorId, authorName: users.name, body: counselComments.body, createdAt: counselComments.createdAt })
    .from(counselComments)
    .leftJoin(users, eq(users.id, counselComments.authorId))
    .where(eq(counselComments.logId, logId))
    .orderBy(asc(counselComments.createdAt));
  return { ...row.l, memberName: m?.name ?? "", seatNo: m?.seatNo ?? null, issueByName: row.issueByName, resolutionByName: row.resolutionByName, comments };
}

const MENTION_RE = /@([^\s@,.!?]+)/g;

export async function addComment(ctx: Ctx, logId: string, body: string, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...STAFF_ROLES);
  const text = body.trim();
  if (!text) return;
  await db.transaction(async (tx) => {
    const [log] = await tx.select().from(counselLogs).where(and(eq(counselLogs.id, logId), eq(counselLogs.branchId, ctx.branchId))).limit(1);
    if (!log) throw new NotFoundError("일지를 찾을 수 없습니다");
    const prev = await tx.select({ authorId: counselComments.authorId }).from(counselComments).where(eq(counselComments.logId, logId));
    await tx.insert(counselComments).values({ logId, authorId: ctx.userId, body: text });

    // 멘션 대상: 지점 소속 사용자 + 본사 관리자 중 이름이 정확히 일치하는 사람
    const names = [...text.matchAll(MENTION_RE)].map((m) => m[1]);
    const mentioned = new Set<string>();
    if (names.length) {
      const candidates = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .leftJoin(memberships, eq(memberships.userId, users.id))
        .where(and(eq(users.active, true), sql`(${memberships.branchId} = ${ctx.branchId} or ${users.isHqAdmin} = true)`));
      for (const c of candidates) if (names.includes(c.name)) mentioned.add(c.id);
    }
    mentioned.delete(ctx.userId);

    const others = new Set<string>([...prev.map((p) => p.authorId), log.issueBy ?? "", log.resolutionBy ?? ""].filter(Boolean));
    others.delete(ctx.userId);
    for (const id of mentioned) others.delete(id);

    const payload = { logId, memberId: log.memberId, preview: text.slice(0, 80) };
    await notify(tx, [...mentioned], "mention", payload, ctx.branchId);
    await notify(tx, [...others], "comment", payload, ctx.branchId);
  });
}

export async function findLogId(ctx: Ctx, memberId: string, logType: CounselLogType, periodDate: string, db: Db = defaultDb): Promise<string | null> {
  const [row] = await db
    .select({ id: counselLogs.id })
    .from(counselLogs)
    .where(and(eq(counselLogs.branchId, ctx.branchId), eq(counselLogs.memberId, memberId), eq(counselLogs.logType, logType), eq(counselLogs.periodDate, periodDate)))
    .limit(1);
  return row?.id ?? null;
}

export async function listLogsForMember(ctx: Ctx, memberId: string, db: Db = defaultDb) {
  requireRole(ctx, ...STAFF_ROLES);
  await assertMemberInBranch(ctx, memberId, db);
  return selectLogs(db).where(eq(counselLogs.memberId, memberId)).orderBy(desc(counselLogs.periodDate));
}

export async function missingWeeklyCount(ctx: Ctx, weekStart: string, db: Db = defaultDb): Promise<number> {
  const list = await gridMembers(ctx, false, db);
  if (list.length === 0) return 0;
  const written = await db
    .select({ memberId: counselLogs.memberId })
    .from(counselLogs)
    .where(and(eq(counselLogs.branchId, ctx.branchId), eq(counselLogs.logType, "weekly"), eq(counselLogs.periodDate, weekStart)));
  const done = new Set(written.map((w) => w.memberId));
  return list.filter((m) => !done.has(m.id)).length;
}
