import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { members, mockExamApplications, mockExamRounds, seats } from "@/db/schema";
import { MANAGER_ROLES, requireRole, STAFF_ROLES, type Ctx } from "@/lib/auth/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";

export type RoundInput = { id?: string; yearMonth: string; name: string; price: number };
export type RoundRow = typeof mockExamRounds.$inferSelect & { appliedCount: number };

export async function listRounds(ctx: Ctx, db: Db = defaultDb): Promise<RoundRow[]> {
  requireRole(ctx, ...STAFF_ROLES);
  const rows = await db
    .select({
      r: mockExamRounds,
      appliedCount: count(sql`case when ${mockExamApplications.applied} then 1 end`),
    })
    .from(mockExamRounds)
    .leftJoin(mockExamApplications, eq(mockExamApplications.roundId, mockExamRounds.id))
    .where(eq(mockExamRounds.branchId, ctx.branchId))
    .groupBy(mockExamRounds.id)
    .orderBy(desc(mockExamRounds.yearMonth), asc(mockExamRounds.name));
  return rows.map((x) => ({ ...x.r, appliedCount: Number(x.appliedCount) }));
}

export async function upsertRound(ctx: Ctx, input: RoundInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...MANAGER_ROLES);
  if (!/^\d{4}-\d{2}$/.test(input.yearMonth)) throw new ValidationError("회차 월은 YYYY-MM 형식");
  const name = input.name.trim();
  if (!name) throw new ValidationError("회차 이름을 입력하세요");
  if (!Number.isInteger(input.price) || input.price < 0) throw new ValidationError("가격은 0 이상의 정수");
  const [dup] = await db
    .select({ id: mockExamRounds.id })
    .from(mockExamRounds)
    .where(and(eq(mockExamRounds.branchId, ctx.branchId), eq(mockExamRounds.yearMonth, input.yearMonth), eq(mockExamRounds.name, name)))
    .limit(1);
  if (dup && dup.id !== input.id) throw new ValidationError("같은 월에 같은 이름의 회차가 있습니다");
  if (input.id) {
    const [existing] = await db.select().from(mockExamRounds).where(and(eq(mockExamRounds.id, input.id), eq(mockExamRounds.branchId, ctx.branchId))).limit(1);
    if (!existing) throw new NotFoundError("회차를 찾을 수 없습니다");
    await db.update(mockExamRounds).set({ yearMonth: input.yearMonth, name, price: input.price }).where(eq(mockExamRounds.id, input.id));
    return input.id;
  }
  const [row] = await db.insert(mockExamRounds).values({ branchId: ctx.branchId, yearMonth: input.yearMonth, name, price: input.price }).returning({ id: mockExamRounds.id });
  return row.id;
}

async function findRound(ctx: Ctx, roundId: string, db: Db) {
  const [r] = await db.select().from(mockExamRounds).where(and(eq(mockExamRounds.id, roundId), eq(mockExamRounds.branchId, ctx.branchId))).limit(1);
  if (!r) throw new NotFoundError("회차를 찾을 수 없습니다");
  return r;
}

export type GridRow = {
  memberId: string;
  name: string;
  seatNo: number | null;
  memberTrack: string | null;
  school: string | null;
  grade: string | null;
  applied: boolean;
  track: string | null;
  subjects: string | null;
  paidAt: string | null;
  paidAmount: number | null;
  note: string | null;
};

export type RoundSummary = { applied: number; paid: number; unpaid: number; byTrack: Record<string, number>; expectedAmount: number; paidAmount: number };

export async function roundGrid(ctx: Ctx, roundId: string, db: Db = defaultDb): Promise<{ round: typeof mockExamRounds.$inferSelect; rows: GridRow[]; summary: RoundSummary }> {
  requireRole(ctx, ...STAFF_ROLES);
  const round = await findRound(ctx, roundId, db);
  const rows = await db
    .select({
      memberId: members.id,
      name: members.name,
      seatNo: seats.seatNo,
      memberTrack: members.track,
      school: members.school,
      grade: members.grade,
      applied: mockExamApplications.applied,
      track: mockExamApplications.track,
      subjects: mockExamApplications.subjects,
      paidAt: mockExamApplications.paidAt,
      paidAmount: mockExamApplications.paidAmount,
      note: mockExamApplications.note,
    })
    .from(members)
    .leftJoin(seats, eq(seats.id, members.seatId))
    .leftJoin(mockExamApplications, and(eq(mockExamApplications.memberId, members.id), eq(mockExamApplications.roundId, roundId)))
    .where(and(eq(members.branchId, ctx.branchId), eq(members.status, "enrolled")))
    .orderBy(sql`${seats.seatNo} asc nulls last`, asc(members.name));
  const grid = rows.map((r) => ({ ...r, applied: r.applied ?? false }));
  const appliedRows = grid.filter((r) => r.applied);
  const byTrack: Record<string, number> = {};
  for (const r of appliedRows) {
    const t = r.track ?? r.memberTrack ?? "미지정";
    byTrack[t] = (byTrack[t] ?? 0) + 1;
  }
  const paid = appliedRows.filter((r) => r.paidAt).length;
  return {
    round,
    rows: grid,
    summary: {
      applied: appliedRows.length,
      paid,
      unpaid: appliedRows.length - paid,
      byTrack,
      expectedAmount: appliedRows.length * round.price,
      paidAmount: appliedRows.reduce((a, r) => a + (r.paidAmount ?? 0), 0),
    },
  };
}

export type ApplicationInput = { roundId: string; memberId: string; applied: boolean; track: string | null; subjects: string | null; paidAt: string | null; paidAmount: number | null; note: string | null };

export async function upsertApplication(ctx: Ctx, input: ApplicationInput, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...MANAGER_ROLES);
  const round = await findRound(ctx, input.roundId, db);
  const [m] = await db.select({ id: members.id }).from(members).where(and(eq(members.id, input.memberId), eq(members.branchId, ctx.branchId))).limit(1);
  if (!m) throw new NotFoundError("회원을 찾을 수 없습니다");
  if (input.paidAt && !/^\d{4}-\d{2}-\d{2}$/.test(input.paidAt)) throw new ValidationError("결제일 형식은 YYYY-MM-DD");
  const vals = {
    applied: input.applied,
    track: input.applied ? input.track : null,
    subjects: input.applied ? input.subjects : null,
    paidAt: input.applied ? input.paidAt : null,
    // 결제일만 입력하면 응시료를 결제액으로 본다
    paidAmount: input.applied && input.paidAt ? (input.paidAmount ?? round.price) : input.applied ? input.paidAmount : null,
    note: input.note,
  };
  await db
    .insert(mockExamApplications)
    .values({ roundId: input.roundId, memberId: input.memberId, ...vals })
    .onConflictDoUpdate({ target: [mockExamApplications.roundId, mockExamApplications.memberId], set: vals });
}
