import { createHash, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { branches, handoverComments, handoverNotes, handoverReads, memberships, shiftSlots, users, type HandoverKind } from "@/db/schema";
import { ALL_ROLES, requireRole, type Ctx } from "@/lib/auth/ctx";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseJandiOutgoing } from "@/lib/rules/webhook";
import { addDays, toDateKey, todayKey } from "@/lib/rules/week";
import { employmentLabel } from "@/lib/rules/worklog";
import { notify } from "@/modules/notifications/repo";
import { enqueueEvent } from "@/modules/outbox/repo";

/**
 * 인수인계 노트.
 *
 * 매장은 근무 타임이 나뉘어 있고 사람이 계속 바뀐다. 잔디를 공용 계정 하나로 쓰면
 * 자기 근무시간이 아닐 때 오간 이야기를 찾을 수 없다. 여기서는 개인 계정으로 읽음을
 * 기록해서, 로그인하면 "내가 없던 사이에 올라온 것"만 모아 보여 준다.
 */
export const HANDOVER_KINDS: { key: HandoverKind; label: string }[] = [
  { key: "handover", label: "인수인계" },
  { key: "request", label: "해 주세요" },
  { key: "notice", label: "공지" },
];
export const KIND_LABEL: Record<HandoverKind, string> = { handover: "인수인계", notice: "공지", request: "해 주세요" };

export type HandoverRow = typeof handoverNotes.$inferSelect & {
  authorName: string | null;
  doneByName: string | null;
  slotName: string | null;
  commentCount: number;
  readCount: number;
  unread: boolean;
};

export type HandoverComment = typeof handoverComments.$inferSelect & { authorName: string | null };

/** 근무 타임 이름. 근무 형태마다 '1타임'이 따로 있어서 형태를 앞에 붙인다 (주간조교 1타임, 원장 1타임) */
function slotName(s: { name: string; audience: string | null }): string {
  return s.audience ? `${employmentLabel(s.audience)} ${s.name}` : s.name;
}

export type NoteInput = { id?: string; date: string; slotKey?: string | null; kind: HandoverKind; body: string };

async function decorate(rows: (typeof handoverNotes.$inferSelect)[], ctx: Ctx, db: Db): Promise<HandoverRow[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const authorIds = [...new Set(rows.flatMap((r) => [r.authorId, r.doneBy]).filter((v): v is string => Boolean(v)))];
  const [authors, slots, comments, reads, mine] = await Promise.all([
    authorIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, authorIds)) : Promise.resolve([]),
    db.select({ key: shiftSlots.key, name: shiftSlots.label, audience: shiftSlots.audience }).from(shiftSlots).where(eq(shiftSlots.branchId, ctx.branchId)),
    db.select({ noteId: handoverComments.noteId, n: sql<string>`count(*)` }).from(handoverComments).where(inArray(handoverComments.noteId, ids)).groupBy(handoverComments.noteId),
    db.select({ noteId: handoverReads.noteId, n: sql<string>`count(*)` }).from(handoverReads).where(inArray(handoverReads.noteId, ids)).groupBy(handoverReads.noteId),
    db.select({ noteId: handoverReads.noteId }).from(handoverReads).where(and(inArray(handoverReads.noteId, ids), eq(handoverReads.userId, ctx.userId))),
  ]);
  const aById = new Map(authors.map((a) => [a.id, a.name]));
  const sByKey = new Map(slots.map((s) => [s.key, slotName(s)]));
  const cById = new Map(comments.map((c) => [c.noteId, Number(c.n)]));
  const rById = new Map(reads.map((r) => [r.noteId, Number(r.n)]));
  const readByMe = new Set(mine.map((m) => m.noteId));
  return rows.map((r) => ({
    ...r,
    authorName: r.authorId ? (aById.get(r.authorId) ?? null) : null,
    doneByName: r.doneBy ? (aById.get(r.doneBy) ?? null) : null,
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
  // '해 주세요'는 위쪽 칸에 따로 모은다
  return [...list.filter((r) => r.kind === "notice"), ...list.filter((r) => r.kind === "handover")];
}

/**
 * '해 주세요' 칸: 아직 안 한 일은 날짜와 상관없이 전부, 해 놓은 일은 최근 3일 것만.
 * 인수인계 글은 읽으면 끝이지만 이건 누군가 해야 끝난다 — 그래서 목록이 따로다.
 */
export async function listRequests(ctx: Ctx, today = toDateKey(new Date()), db: Db = defaultDb): Promise<{ open: HandoverRow[]; done: HandoverRow[] }> {
  requireRole(ctx, ...ALL_ROLES);
  const since = addDays(today, -3);
  const rows = await db
    .select()
    .from(handoverNotes)
    .where(and(eq(handoverNotes.branchId, ctx.branchId), eq(handoverNotes.kind, "request"), or(isNull(handoverNotes.doneAt), gte(handoverNotes.doneAt, since))))
    .orderBy(asc(handoverNotes.date), asc(handoverNotes.createdAt))
    .limit(200);
  const list = await decorate(rows, ctx, db);
  return { open: list.filter((r) => !r.doneAt), done: list.filter((r) => r.doneAt).sort((a, b) => (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0)) };
}

/** 대시보드·이슈함에 보이는 남은 '해 주세요' 수 */
export async function openRequestCount(ctx: Ctx, db: Db = defaultDb): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(handoverNotes)
    .where(and(eq(handoverNotes.branchId, ctx.branchId), eq(handoverNotes.kind, "request"), isNull(handoverNotes.doneAt)));
  return Number(row?.n ?? 0);
}

/** '해 주세요'를 했다고 표시하거나 되돌린다. 누구나 할 수 있고, 한 사람이 표시하면 부탁한 사람에게 알린다 */
export async function setRequestDone(ctx: Ctx, id: string, done: boolean, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...ALL_ROLES);
  const note = await getNote(ctx, id, db);
  if (note.kind !== "request") throw new ValidationError("'해 주세요' 글만 완료로 표시할 수 있습니다");
  if (!done) {
    await db
      .update(handoverNotes)
      .set({ doneAt: null, doneBy: null })
      .where(and(eq(handoverNotes.id, id), eq(handoverNotes.branchId, ctx.branchId)));
    return;
  }
  // 두 사람이 거의 같이 눌러도(또는 두 번 눌러도) 처음 한 번만 기록하고 알린다
  const updated = await db
    .update(handoverNotes)
    .set({ doneAt: new Date(), doneBy: ctx.userId })
    .where(and(eq(handoverNotes.id, id), eq(handoverNotes.branchId, ctx.branchId), isNull(handoverNotes.doneAt)))
    .returning({ id: handoverNotes.id });
  if (updated.length && note.authorId && note.authorId !== ctx.userId) {
    await notify(db, [note.authorId], "handover", { title: `해 놓았어요 · ${note.body.slice(0, 40)} (${ctx.userName})`, noteId: id }, ctx.branchId);
  }
}

/**
 * 상단바·대시보드에 쓰는 안 읽은 건수. '해 주세요'는 읽음 표시가 없는 글이라 빼고(남은 일 수는 openRequestCount 로 따로 센다),
 * 인수인계·공지만 센다 — 목록(listNotes)에 보이는 것과 같아야 '모두 읽음'을 눌러 0이 된다.
 */
export async function unreadNoteCount(ctx: Ctx, days = 14, today = toDateKey(new Date()), db: Db = defaultDb): Promise<number> {
  const from = toDateKey(addDays(today, -days));
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(handoverNotes)
    .leftJoin(handoverReads, and(eq(handoverReads.noteId, handoverNotes.id), eq(handoverReads.userId, ctx.userId)))
    .where(
      and(
        eq(handoverNotes.branchId, ctx.branchId),
        ne(handoverNotes.kind, "request"),
        sql`${handoverNotes.date} >= ${from}`,
        isNull(handoverReads.noteId),
        sql`${handoverNotes.authorId} is distinct from ${ctx.userId}`,
      ),
    );
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
  // 공지와 '해 주세요'는 지점 사람들에게 알림까지 보낸다 — 다음에 누가 근무할지 모르니 모두에게.
  // 메신저(잔디 등)를 구독해 두었으면 그 채널에도 올린다
  if (input.kind === "notice" || input.kind === "request") {
    const staff = await branchUserIds(ctx, db);
    await notify(db, staff.filter((u) => u !== ctx.userId), "handover", { title: `${KIND_LABEL[input.kind]} · ${body.slice(0, 40)}`, noteId: row.id }, ctx.branchId);
    await enqueueEvent(db, ctx.branchId, input.kind === "notice" ? "handover.notice" : "handover.request", { noteId: row.id, body, author: ctx.userName, date: input.date }, `[${KIND_LABEL[input.kind]}] ${body.slice(0, 200)} (${ctx.userName})`);
  }
  return row.id;
}

async function branchUserIds(ctx: Ctx, db: Db): Promise<string[]> {
  const rows = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.branchId, ctx.branchId));
  return rows.map((r) => r.userId);
}

/**
 * 잔디에서 '/해주세요 3층 정수기 업체에 전화' 처럼 쓴 글을 '해 주세요' 칸에 올린다(잔디 아웃고잉 웹훅).
 * 로그인한 사람이 없으므로 지점 설정에 저장한 토큰으로 우리 지점 글인지 확인하고, 쓴 사람은 잔디가 알려 준 이름을 본문 끝에 남긴다.
 * 잔디 쪽 채널에 다시 올리는 메신저 이벤트는 쌓지 않는다 — 잔디에는 응답으로 바로 답한다.
 */
export async function createRequestFromJandi(branchCode: string, payload: Record<string, unknown>, db: Db = defaultDb): Promise<{ id: string; body: string }> {
  const [branch] = await db.select({ id: branches.id, tokenHash: branches.jandiTokenHash }).from(branches).where(and(eq(branches.code, branchCode), eq(branches.active, true))).limit(1);
  if (!branch) throw new NotFoundError("지점 코드를 찾을 수 없습니다");
  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  if (!branch.tokenHash || !token) throw new ForbiddenError("잔디 연동이 설정되지 않았거나 토큰이 없습니다");
  const given = Buffer.from(createHash("sha256").update(token).digest("hex"));
  const stored = Buffer.from(branch.tokenHash);
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) throw new ForbiddenError("토큰이 올바르지 않습니다");

  const { text, writerName } = parseJandiOutgoing(payload);
  if (!text) throw new ValidationError("부탁할 내용을 키워드 뒤에 적어 주세요");
  const body = `${text.slice(0, 2000)}\n— 잔디에서 ${writerName ?? "이름 없음"}`;
  const [row] = await db
    .insert(handoverNotes)
    .values({ branchId: branch.id, authorId: null, date: todayKey(), kind: "request", body })
    .returning({ id: handoverNotes.id });
  const staff = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.branchId, branch.id));
  await notify(db, staff.map((r) => r.userId), "handover", { title: `해 주세요 · ${text.slice(0, 40)}`, noteId: row.id }, branch.id);
  return { id: row.id, body };
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
  const rows = await db
    .select({ key: shiftSlots.key, name: shiftSlots.label, audience: shiftSlots.audience })
    .from(shiftSlots)
    .where(and(eq(shiftSlots.branchId, ctx.branchId), eq(shiftSlots.active, true)))
    .orderBy(asc(shiftSlots.sort));
  return rows.map((r) => ({ key: r.key, name: slotName(r) }));
}
