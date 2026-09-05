import { and, asc, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db as defaultDb, type Db, type Tx } from "@/db/client";
import {
  accessLogs,
  auditLogs,
  checks,
  counselComments,
  counselLogs,
  issues,
  memberEnrollments,
  memberGuardians,
  members,
  penaltyRules,
  seats,
  users,
  type MemberStatus,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { MANAGER_ROLES, requireRole, type Ctx } from "@/lib/auth/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { currentEnrollment, daysLeft } from "@/lib/rules/enrollment";
import { validateCustomValues } from "@/lib/rules/custom-fields";
import { todayKey } from "@/lib/rules/week";
import { customFieldsFor } from "@/modules/settings/repo";
import { memberInputSchema, type MemberInput, type MemberInputParsed } from "./schema";

export type MemberListFilter = { status?: MemberStatus; focusCare?: boolean; track?: string; q?: string };

export type MemberRow = {
  id: string;
  name: string;
  seatNo: number | null;
  zone: string | null;
  status: MemberStatus;
  focusCare: boolean;
  memberKind: string;
  studentType: string | null;
  school: string | null;
  grade: string | null;
  track: string | null;
  fieldNote: string | null;
  /** 조교 역할에는 없음 */
  phone?: string | null;
};

export type MemberDetail = typeof members.$inferSelect & {
  seatNo: number | null;
  zone: string | null;
  guardians: (typeof memberGuardians.$inferSelect)[];
  enrollments: (typeof memberEnrollments.$inferSelect)[];
  currentEnrollment: (typeof memberEnrollments.$inferSelect) | null;
  daysLeft: number | null;
};

export type TimelineItem = {
  at: Date;
  kind: "counsel" | "comment" | "penalty" | "issue" | "audit";
  title: string;
  body: string | null;
  actor: string | null;
  href?: string;
};

const baseCols = {
  id: members.id,
  name: members.name,
  seatNo: seats.seatNo,
  zone: seats.zone,
  status: members.status,
  focusCare: members.focusCare,
  memberKind: members.memberKind,
  studentType: members.studentType,
  school: members.school,
  grade: members.grade,
  track: members.track,
  fieldNote: members.fieldNote,
};

export async function listMembers(ctx: Ctx, f: MemberListFilter = {}, db: Db = defaultDb): Promise<MemberRow[]> {
  const conds = [eq(members.branchId, ctx.branchId)];
  if (f.status) conds.push(eq(members.status, f.status));
  if (f.focusCare !== undefined) conds.push(eq(members.focusCare, f.focusCare));
  if (f.track) conds.push(eq(members.track, f.track));
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    conds.push(or(ilike(members.name, q), ilike(members.school, q), sql`cast(${seats.seatNo} as text) = ${f.q.trim()}`)!);
  }
  const cols = ctx.role === "assistant" ? baseCols : { ...baseCols, phone: members.phone };
  const rows = await db
    .select(cols)
    .from(members)
    .leftJoin(seats, eq(seats.id, members.seatId))
    .where(and(...conds))
    .orderBy(sql`${seats.seatNo} asc nulls last`, asc(members.name));
  return rows as MemberRow[];
}

async function findOwned(ctx: Ctx, id: string, db: Db | Tx) {
  const [row] = await db
    .select({ m: members, seatNo: seats.seatNo, zone: seats.zone })
    .from(members)
    .leftJoin(seats, eq(seats.id, members.seatId))
    .where(and(eq(members.id, id), eq(members.branchId, ctx.branchId)))
    .limit(1);
  if (!row) throw new NotFoundError("회원을 찾을 수 없습니다");
  return row;
}

export async function getMember(ctx: Ctx, id: string, db: Db = defaultDb): Promise<MemberDetail> {
  const row = await findOwned(ctx, id, db);
  const enrollments = await db
    .select()
    .from(memberEnrollments)
    .where(eq(memberEnrollments.memberId, id))
    .orderBy(desc(memberEnrollments.startDate));
  const cur = currentEnrollment(enrollments, todayKey());
  const restricted = ctx.role === "assistant";
  const guardians = restricted ? [] : await db.select().from(memberGuardians).where(eq(memberGuardians.memberId, id));
  if (!restricted) {
    await db.insert(accessLogs).values({ actorId: ctx.userId, branchId: ctx.branchId, entity: "member", entityId: id });
  }
  return {
    ...row.m,
    phone: restricted ? null : row.m.phone,
    address: restricted ? null : row.m.address,
    birthDate: restricted ? null : row.m.birthDate,
    seatNo: row.seatNo,
    zone: row.zone,
    guardians,
    enrollments,
    currentEnrollment: cur,
    daysLeft: cur ? daysLeft(cur, todayKey()) : null,
  };
}

async function assertSeatInBranch(ctx: Ctx, seatId: string, db: Db | Tx) {
  const [seat] = await db.select().from(seats).where(and(eq(seats.id, seatId), eq(seats.branchId, ctx.branchId))).limit(1);
  if (!seat) throw new NotFoundError("좌석을 찾을 수 없습니다");
  return seat;
}

async function assertSeatFree(seatId: string, exceptMemberId: string | null, db: Db | Tx) {
  const conds = [eq(members.seatId, seatId), eq(members.status, "enrolled")];
  if (exceptMemberId) conds.push(ne(members.id, exceptMemberId));
  const [occupant] = await db.select({ name: members.name }).from(members).where(and(...conds)).limit(1);
  if (occupant) throw new ValidationError(`이미 사용 중인 좌석입니다 (${occupant.name})`);
}

function memberColumns(input: MemberInputParsed) {
  return {
    name: input.name,
    phone: input.phone ?? null,
    birthDate: input.birthDate ?? null,
    gender: input.gender ?? null,
    memberKind: input.memberKind,
    studentType: input.studentType ?? null,
    school: input.school ?? null,
    grade: input.grade ?? null,
    track: input.track ?? null,
    target: input.target ?? null,
    address: input.address ?? null,
    focusCare: input.focusCare,
    firstRegisteredAt: input.firstRegisteredAt ?? null,
    firstCounseledAt: input.firstCounseledAt ?? null,
    memo: input.memo ?? null,
    fieldNote: input.fieldNote ?? null,
  };
}

function parse(input: MemberInput): MemberInputParsed {
  const r = memberInputSchema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues.map((i) => i.message).join(", "));
  return r.data;
}

export async function createMember(ctx: Ctx, rawInput: MemberInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...MANAGER_ROLES);
  const input = parse(rawInput);
  const seatId = input.status === "enrolled" ? (input.seatId ?? null) : null;
  return db.transaction(async (tx) => {
    if (seatId) {
      await assertSeatInBranch(ctx, seatId, tx);
      await assertSeatFree(seatId, null, tx);
    }
    const defs = await customFieldsFor(ctx, "member", tx);
    const custom = validateCustomValues(defs, input.custom ?? {});
    const [m] = await tx
      .insert(members)
      .values({ ...memberColumns(input), branchId: ctx.branchId, status: input.status, seatId, custom })
      .returning();
    const g = input.guardian;
    if (g && (g.name || g.phone)) {
      await tx.insert(memberGuardians).values({ memberId: m.id, name: g.name ?? null, relation: g.relation ?? null, phone: g.phone ?? null });
    }
    if (input.enrollment) {
      await tx.insert(memberEnrollments).values({ memberId: m.id, ...input.enrollment, note: input.enrollment.note ?? null });
    }
    await writeAudit(tx, ctx, "member", m.id, "create", null, { name: m.name, status: m.status, seatId });
    return m.id;
  });
}

export async function updateMember(ctx: Ctx, id: string, rawInput: MemberInput, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...MANAGER_ROLES);
  const input = parse(rawInput);
  await db.transaction(async (tx) => {
    const before = await findOwned(ctx, id, tx);
    const cols = memberColumns(input);
    const defs = await customFieldsFor(ctx, "member", tx);
    const custom = input.custom ? { ...before.m.custom, ...validateCustomValues(defs, input.custom) } : before.m.custom;
    await tx.update(members).set({ ...cols, custom }).where(eq(members.id, id));

    const g = input.guardian;
    if (g) {
      const [existing] = await tx.select().from(memberGuardians).where(eq(memberGuardians.memberId, id)).limit(1);
      const vals = { name: g.name ?? null, relation: g.relation ?? null, phone: g.phone ?? null };
      if (existing) await tx.update(memberGuardians).set(vals).where(eq(memberGuardians.id, existing.id));
      else if (vals.name || vals.phone) await tx.insert(memberGuardians).values({ memberId: id, ...vals });
    }
    const e = input.enrollment;
    if (e) {
      const [latest] = await tx.select().from(memberEnrollments).where(eq(memberEnrollments.memberId, id)).orderBy(desc(memberEnrollments.startDate)).limit(1);
      const vals = { startDate: e.startDate, endDate: e.endDate, planType: e.planType, note: e.note ?? null };
      if (latest) await tx.update(memberEnrollments).set(vals).where(eq(memberEnrollments.id, latest.id));
      else await tx.insert(memberEnrollments).values({ memberId: id, ...vals });
    }
    const changed: Record<string, [unknown, unknown]> = {};
    for (const k of Object.keys(cols) as (keyof typeof cols)[]) {
      if ((before.m[k] ?? null) !== (cols[k] ?? null)) changed[k] = [before.m[k] ?? null, cols[k] ?? null];
    }
    if (Object.keys(changed).length) {
      const b: Record<string, unknown> = {};
      const a: Record<string, unknown> = {};
      for (const [k, [x, y]] of Object.entries(changed)) {
        b[k] = x;
        a[k] = y;
      }
      await writeAudit(tx, ctx, "member", id, "update", b, a);
    }
  });
}

export async function changeStatus(ctx: Ctx, id: string, status: MemberStatus, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...MANAGER_ROLES);
  await db.transaction(async (tx) => {
    const before = await findOwned(ctx, id, tx);
    const keepSeat = status === "enrolled" || status === "paused";
    const seatId = keepSeat ? before.m.seatId : null;
    const withdrawnAt = status === "withdrawn" ? (before.m.withdrawnAt ?? todayKey()) : null;
    await tx.update(members).set({ status, seatId, withdrawnAt }).where(eq(members.id, id));
    await writeAudit(tx, ctx, "member", id, "status", { status: before.m.status, seatId: before.m.seatId }, { status, seatId });
  });
}

export async function assignSeat(ctx: Ctx, id: string, seatId: string | null, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...MANAGER_ROLES);
  await db.transaction(async (tx) => {
    const before = await findOwned(ctx, id, tx);
    if (seatId) {
      await assertSeatInBranch(ctx, seatId, tx);
      await assertSeatFree(seatId, id, tx);
    }
    await tx.update(members).set({ seatId }).where(eq(members.id, id));
    await writeAudit(tx, ctx, "member", id, "seat", { seatId: before.m.seatId, seatNo: before.seatNo }, { seatId });
  });
}

export type SeatOccupancy = { seatId: string; seatNo: number; zone: string; active: boolean; memberId: string | null; memberName: string | null };

export async function listSeatsWithOccupant(ctx: Ctx, db: Db = defaultDb): Promise<SeatOccupancy[]> {
  const rows = await db
    .select({ seatId: seats.id, seatNo: seats.seatNo, zone: seats.zone, active: seats.active, memberId: members.id, memberName: members.name })
    .from(seats)
    .leftJoin(members, and(eq(members.seatId, seats.id), eq(members.status, "enrolled")))
    .where(eq(seats.branchId, ctx.branchId))
    .orderBy(asc(seats.sort), asc(seats.seatNo));
  return rows;
}

export async function memberTimeline(ctx: Ctx, id: string, db: Db = defaultDb): Promise<TimelineItem[]> {
  await findOwned(ctx, id, db);
  const items: TimelineItem[] = [];

  if (ctx.role !== "assistant") {
    const logs = await db
      .select({ l: counselLogs, issueByName: users.name })
      .from(counselLogs)
      .leftJoin(users, eq(users.id, counselLogs.issueBy))
      .where(eq(counselLogs.memberId, id));
    for (const { l, issueByName } of logs) {
      const label = l.logType === "weekly" ? "주간 상담" : "집중관리 일지";
      if (l.issueText) items.push({ at: l.issueAt ?? l.createdAt, kind: "counsel", title: `${label} · 정보 및 이슈 (${l.periodDate})`, body: l.issueText, actor: issueByName, href: `/counsel/logs/${l.id}` });
      if (l.resolutionText) items.push({ at: l.resolutionAt ?? l.updatedAt, kind: "counsel", title: `${label} · 해결 내용 (${l.periodDate})`, body: l.resolutionText, actor: null, href: `/counsel/logs/${l.id}` });
    }
    const comments = await db
      .select({ c: counselComments, author: users.name, logId: counselLogs.id })
      .from(counselComments)
      .innerJoin(counselLogs, eq(counselLogs.id, counselComments.logId))
      .leftJoin(users, eq(users.id, counselComments.authorId))
      .where(eq(counselLogs.memberId, id));
    for (const { c, author, logId } of comments) items.push({ at: c.createdAt, kind: "comment", title: "코멘트", body: c.body, actor: author, href: `/counsel/logs/${logId}` });
  }

  const penalties = await db
    .select({ c: checks, rule: penaltyRules.name, by: users.name })
    .from(checks)
    .leftJoin(penaltyRules, eq(penaltyRules.id, checks.penaltyRuleId))
    .leftJoin(users, eq(users.id, checks.createdBy))
    .where(and(eq(checks.memberId, id), eq(checks.grade, "p")));
  for (const { c, rule, by } of penalties) {
    const where = c.itemKey === "round" ? `R${c.roundNo}` : c.itemKey;
    items.push({ at: c.createdAt, kind: "penalty", title: `벌점 ${c.points}점 · ${rule ?? "규칙 없음"} (${c.date} ${where})`, body: c.note, actor: by });
  }

  const issueRows = await db
    .select({ i: issues, by: users.name })
    .from(issues)
    .leftJoin(users, eq(users.id, issues.reportedBy))
    .where(eq(issues.memberId, id));
  for (const { i, by } of issueRows) items.push({ at: i.createdAt, kind: "issue", title: `이슈 · ${i.title}`, body: i.body, actor: by, href: `/issues/${i.id}` });

  const audits = await db
    .select({ a: auditLogs, by: users.name })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(eq(auditLogs.entity, "member"), eq(auditLogs.entityId, id)));
  const actionLabel: Record<string, string> = { create: "회원 등록", update: "정보 수정", status: "상태 변경", seat: "좌석 변경" };
  for (const { a, by } of audits) {
    items.push({ at: a.at, kind: "audit", title: actionLabel[a.action] ?? a.action, body: a.after ? JSON.stringify(a.after) : null, actor: by });
  }

  return items.sort((x, y) => y.at.getTime() - x.at.getTime());
}
