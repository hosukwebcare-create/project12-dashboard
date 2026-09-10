import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { handoverComments, handoverNotes, handoverReads, shiftSlots, users, type HandoverKind } from "@/db/schema";
import { ALL_ROLES, requireRole, type Ctx } from "@/lib/auth/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, toDateKey } from "@/lib/rules/week";
import { notify } from "@/modules/notifications/repo";

/**
 * 인수인계 노트.
 *
 * 매장은 근무 타임이 나뉘어 있고 사람이 계속 바뀐다. 잔디를 공용 계정 하나로 쓰면
 * 자기 근무시간이 아닐 때 오간 이야기를 찾을 수 없다. 여기서는 개인 계정으로 읽음을
 * 기록해서, 로그인하면 "내가 없던 사이에 올라온 것"만 모아 보여 준다.
 */
export const HANDOVER_KINDS: { key: HandoverKind; label: string }[] = [
  { key: "handover", label: "인수인계" },
  { key: "notice", label: "공지" },
];
export const KIND_LABEL: Record<HandoverKind, string> = { handover: "인수인계", notice: "공지" };

export type HandoverRow = typeof handoverNotes.$inferSelect & {
  authorName: string | null;
  slotName: string | null;
  commentCount: number;
  readCount: number;
  unread: boolean;
};

export type HandoverComment = typeof handoverComments.$inferSelect & { authorName: string | null };

export type NoteInput = { id?: string; date: string; slotKey?: string | null; kind: HandoverKind; body: string };

async function decorate(rows: (typeof handoverNotes.$inferSelect)[], ctx: Ctx, db: Db): Promise<HandoverRow[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const authorIds = [...new Set(rows.map((r) => r.authorId).filter((v): v is string => Boolean(v)))];
  const [authors, slots, comments, reads, mine] = await Promise.all([
    authorIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, authorIds)) : Promise.resolve([]),
    db.select({ key: shiftSlots.key, name: shiftSlots.label }).from(shiftSlots).where(eq(shiftSlots.branchId, ctx.branchId)),
    db.select({ noteId: handoverComments.noteId, n: sql<string>`count(*)` }).from(handoverComments).where(inArray(handoverComments.noteId, ids)).groupBy(handoverComments.noteId),
    db.select({ noteId: handoverReads.noteId, n: sql<string>`count(*)` }).from(handoverReads).where(inArray(handoverReads.noteId, ids)).groupBy(handoverReads.noteId),
    db.select({ noteId: handoverReads.noteId }).from(handoverReads).where(and(inArray(handoverReads.noteId, ids), eq(handoverReads.userId, ctx.userId))),
  ]);
  const aById = new Map(authors.map((a) => [a.id, a.name]));
  const sByKey = new Map(slots.map((s) => [s.key, s.name]));
  const cById = new Map(comments.map((c) => [c.noteId, Number(c.n)]));
  const rById = new Map(reads.map((r) => [r.noteId, Number(r.n)]));
  const readByMe = new Set(mine.map((m) => m.noteId));
  return rows.map((r) => ({
    ...r,
    authorName: r.authorId ? (aById.get(r.authorId) ?? null) : null,
    slotName: r.slotKey ? (sByKey.get(r.slotKey) ?? r.slotKey) : null,
    commentCount: cById.get(r.id) ?? 0,
    readCount: rById.get(r.id) ?? 0,
    // 자기가 쓴 글은 안 읽은 것으로 치지 않는다
    unread: r.authorId !== ctx.userId && !readByMe.has(r.id),
  }));
}

/** 최근 n일치. 공지는 위로 올린다 */
export async function listNotes(ctx: Ctx, days = 14, today = toDateKey(new Date()), db: Db = defaultDb): Promise<HandoverRow[]> {
  requireRole(ctx, ...ALL_ROLES);
  const from = toDateKey(addDays(today, -days));
  const rows = await db
    .select()
    .from(handoverNotes)
    .where(and(eq(handoverNotes.branchId, ctx.branchId), sql`${handoverNotes.date} >= ${from}`))
    .orderBy(desc(handoverNotes.date), desc(handoverNotes.createdAt))
    .limit(200);
  const list = await decorate(rows, ctx, db);
  return [...list.filter((r) => r.kind === "notice"), ...list.filter((r) => r.kind !== "notice")];
}

/** 상단바·대시보드에 쓰는 안 읽은 건수 */
export async function unreadNoteCount(ctx: Ctx, days = 14, today = toDateKey(new Date()), db: Db = defaultDb): Promise<number> {
  const from = toDateKey(addDays(today, -days));
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(handoverNotes)
    .leftJoin(handoverReads, and(eq(handoverReads.noteId, handoverNotes.id), eq(handoverReads.userId, ctx.userId)))
    .where(and(eq(handoverNotes.branchId, ctx.branchId), sql`${handoverNotes.date} >= ${from}`, isNull(handoverReads.noteId), sql`${handoverNotes.authorId} is distinct from ${ctx.userId}`));
  return Number(row?.n ?? 0);
}

export async function getNote(ctx: Ctx, id: string, db: Db = defaultDb): Promise<HandoverRow> {
  requireRole(ctx, ...ALL_ROLES);
  const [row] = await db.select().from(handoverNotes).where(and(eq(handoverNotes.id, id), eq(handoverNotes.branchId, ctx.branchId))).limit(1);
  if (!row) throw new NotFoundError("글을 찾을 수 없습니다");
  return (await decorate([row], ctx, db))[0];
}

export async function upsertNote(ctx: Ctx, input: NoteInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...ALL_ROLES);
  const body = input.body.trim();
  if (!body) throw new ValidationError("내용을 입력하세요");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ValidationError("날짜를 고르세요");
  // 공지는 지점장·본사만. 인수인계는 누구나
  if (input.kind === "notice") requireRole(ctx, "hq_admin", "branch_manager");
  const vals = { date: input.date, slotKey: input.slotKey || null, kind: input.kind, body };

  if (input.id) {
    const before = await getNote(ctx, input.id, db);
    // 남의 글은 지점장·본사만 고칠 수 있다
    if (before.authorId !== ctx.userId) requireRole(ctx, "hq_admin", "branch_manager");
    await db.update(handoverNotes).set(vals).where(eq(handoverNotes.id, input.id));
    return input.id;
  }
  const [row] = await db
    .insert(handoverNotes)
    .values({ ...vals, branchId: ctx.branchId, authorId: ctx.userId })
    .returning({ id: handoverNotes.id });
  // 공지는 지점 사람들에게 알림까지 보낸다
  if (input.kind === "notice") {
    const staff = await branchUserIds(ctx, db);
    await notify(db, staff.filter((u) => u !== ctx.userId), "handover", { title: `공지 · ${body.slice(0, 40)}`, noteId: row.id }, ctx.branchId);
  }
  return row.id;
}

async function branchUserIds(ctx: Ctx, db: Db): Promise<string[]> {
  const { memberships } = await import("@/db/schema");
  const rows = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.branchId, ctx.branchId));
  return rows.map((r) => r.userId);
}

export async function deleteNote(ctx: Ctx, id: string, db: Db = defaultDb): Promise<void> {
  const before = await getNote(ctx, id, db);
  if (before.authorId !== ctx.userId) requireRole(ctx, "hq_admin", "branch_manager");
  await db.delete(handoverNotes).where(and(eq(handoverNotes.id, id), eq(handoverNotes.branchId, ctx.branchId)));
}

/**
 * 읽음 표시. 이미 읽었으면 아무 일도 하지 않는다.
 *
 * handover_reads 에는 지점 열이 없어 RLS 가 걸리지 않는다. 글 id 는 화면에서 그대로
 * 넘어오므로, 남의 지점 글 id 를 넣어 그 지점 읽음 수를 올리지 못하도록 여기서 거른다.
 */
export async function markRead(ctx: Ctx, noteIds: string[], db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...ALL_ROLES);
  if (!noteIds.length) return;
  const mine = await db
    .select({ id: handoverNotes.id })
    .from(handoverNotes)
    .where(and(eq(handoverNotes.branchId, ctx.branchId), inArray(handoverNotes.id, noteIds)));
  if (!mine.length) return;
  await db
    .insert(handoverReads)
    .values(mine.map((n) => ({ noteId: n.id, userId: ctx.userId })))
    .onConflictDoNothing();
}

/** 화면에 보이는 것을 모두 읽음으로 */
export async function markAllRead(ctx: Ctx, days = 14, today = toDateKey(new Date()), db: Db = defaultDb): Promise<number> {
  const rows = await listNotes(ctx, days, today, db);
  const ids = rows.filter((r) => r.unread).map((r) => r.id);
  await markRead(ctx, ids, db);
  return ids.length;
}

export async function listComments(ctx: Ctx, noteId: string, db: Db = defaultDb): Promise<HandoverComment[]> {
  requireRole(ctx, ...ALL_ROLES);
  await getNote(ctx, noteId, db);
  const rows = await db
    .select({ c: handoverComments, authorName: users.name })
    .from(handoverComments)
    .leftJoin(users, eq(users.id, handoverComments.authorId))
    .where(eq(handoverComments.noteId, noteId))
    .orderBy(asc(handoverComments.createdAt));
  return rows.map((r) => ({ ...r.c, authorName: r.authorName }));
}

export async function addComment(ctx: Ctx, noteId: string, body: string, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...ALL_ROLES);
  const text = body.trim();
  if (!text) throw new ValidationError("내용을 입력하세요");
  const note = await getNote(ctx, noteId, db);
  await db.insert(handoverComments).values({ noteId, authorId: ctx.userId, body: text });
  // 글쓴이와 먼저 답을 단 사람에게 알린다
  const prior = await db.select({ authorId: handoverComments.authorId }).from(handoverComments).where(eq(handoverComments.noteId, noteId));
  const targets = new Set<string>();
  if (note.authorId) targets.add(note.authorId);
  for (const p of prior) if (p.authorId) targets.add(p.authorId);
  targets.delete(ctx.userId);
  await notify(db, [...targets], "handover", { title: `인수인계 답글 · ${text.slice(0, 40)}`, noteId }, ctx.branchId);
}

/** 근무 타임 선택지 (글을 어느 타임 이야기인지 붙일 때) */
export async function slotOptions(ctx: Ctx, db: Db = defaultDb): Promise<{ key: string; name: string }[]> {
  return db.select({ key: shiftSlots.key, name: shiftSlots.label }).from(shiftSlots).where(eq(shiftSlots.branchId, ctx.branchId)).orderBy(asc(shiftSlots.sort));
}
