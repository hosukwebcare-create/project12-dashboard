import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { feePlans, mealSettlements, memberEnrollments, members, seatPayments, seats, type SeatPaymentStatus } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { MANAGER_ROLES, requireRole, type Ctx } from "@/lib/auth/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, toDateKey } from "@/lib/rules/week";

/**
 * 좌석 이용료 결제.
 *
 * 매장은 좌석 이용료와 식사비를 따로 받는다. 좌석 금액은 좌석 등급(요금표)과 회원 구분
 * (학생/성인)으로 정해지고, 등록기간 한 건이 결제 한 건이 된다. 시트가 하던 계산을 그대로
 * 옮겨서 두 곳을 오갈 필요가 없게 한다.
 */
export const PAYMENT_STATUSES: { key: SeatPaymentStatus; label: string }[] = [
  { key: "pending", label: "예정" },
  { key: "paid", label: "완료" },
  { key: "closed", label: "종료" },
];
export const PAYMENT_STATUS_LABEL: Record<SeatPaymentStatus, string> = { pending: "예정", paid: "완료", closed: "종료" };

// ---------- 요금표 ----------
export type FeePlanRow = typeof feePlans.$inferSelect;
export type FeePlanInput = { id?: string; name: string; studentPrice: number; adultPrice: number; sort: number; active: boolean };

export async function listFeePlans(ctx: Ctx, db: Db = defaultDb): Promise<FeePlanRow[]> {
  return db.select().from(feePlans).where(eq(feePlans.branchId, ctx.branchId)).orderBy(asc(feePlans.sort), asc(feePlans.name));
}

export async function upsertFeePlan(ctx: Ctx, input: FeePlanInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...MANAGER_ROLES);
  const name = input.name.trim();
  if (!name) throw new ValidationError("등급 이름을 입력하세요");
  for (const [label, v] of [["학생 요금", input.studentPrice], ["성인 요금", input.adultPrice]] as const) {
    if (!Number.isInteger(v) || v < 0) throw new ValidationError(`${label}은 0 이상 정수로 입력하세요`);
  }
  const vals = { name, studentPrice: input.studentPrice, adultPrice: input.adultPrice, sort: input.sort, active: input.active };
  if (input.id) {
    await db.update(feePlans).set(vals).where(and(eq(feePlans.id, input.id), eq(feePlans.branchId, ctx.branchId)));
    return input.id;
  }
  const [row] = await db.insert(feePlans).values({ ...vals, branchId: ctx.branchId }).returning({ id: feePlans.id });
  return row.id;
}

/** 좌석마다 등급을 붙인다. 등급이 없으면 금액을 계산할 수 없다 */
export async function setSeatFeePlan(ctx: Ctx, seatId: string, feePlanId: string | null, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...MANAGER_ROLES);
  const [seat] = await db.select({ id: seats.id }).from(seats).where(and(eq(seats.id, seatId), eq(seats.branchId, ctx.branchId))).limit(1);
  if (!seat) throw new NotFoundError("좌석을 찾을 수 없습니다");
  await assertOwnFeePlan(ctx, feePlanId, db);
  await db.update(seats).set({ feePlanId }).where(eq(seats.id, seatId));
}

/** 요금 등급이 이 지점 것인지. 다른 지점 등급 id 를 넣으면 그 지점 요금으로 청구된다 */
async function assertOwnFeePlan(ctx: Ctx, feePlanId: string | null, db: Db): Promise<void> {
  if (!feePlanId) return;
  const [plan] = await db.select({ id: feePlans.id }).from(feePlans).where(and(eq(feePlans.id, feePlanId), eq(feePlans.branchId, ctx.branchId))).limit(1);
  if (!plan) throw new ValidationError("이 지점의 요금 등급 중에서 고르세요");
}

/** 좌석 등급 일괄 지정 (예: 1~10번을 원목으로) */
export async function bulkSetSeatFeePlan(ctx: Ctx, from: number, to: number, feePlanId: string | null, db: Db = defaultDb): Promise<number> {
  requireRole(ctx, ...MANAGER_ROLES);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) throw new ValidationError("좌석 번호 범위를 확인하세요");
  await assertOwnFeePlan(ctx, feePlanId, db);
  const rows = await db
    .update(seats)
    .set({ feePlanId })
    .where(and(eq(seats.branchId, ctx.branchId), gte(seats.seatNo, from), lte(seats.seatNo, to)))
    .returning({ id: seats.id });
  return rows.length;
}

// ---------- 결제 대상 ----------
export type PaymentRow = {
  /** 이미 저장된 결제 건이면 id, 아직 안 만든 것이면 null */
  id: string | null;
  enrollmentId: string;
  memberId: string;
  memberName: string;
  seatNo: number | null;
  memberKind: string;
  periodStart: string;
  periodEnd: string;
  planName: string | null;
  baseAmount: number;
  discount: number;
  amount: number;
  paidAt: string | null;
  paidAmount: number | null;
  status: SeatPaymentStatus;
  note: string | null;
};

/**
 * 등록기간을 기준으로 결제 대상을 만든다. 저장된 결제 건이 있으면 그것을, 없으면
 * 요금표로 계산한 초안을 돌려준다. 초안은 저장하기 전까지 DB에 남지 않는다.
 */
export async function paymentTargets(ctx: Ctx, opts: { from?: string; to?: string } = {}, db: Db = defaultDb): Promise<PaymentRow[]> {
  requireRole(ctx, ...MANAGER_ROLES);
  const today = toDateKey(new Date());
  const from = opts.from ?? toDateKey(addDays(today, -45));
  const to = opts.to ?? toDateKey(addDays(today, 45));

  const rows = await db
    .select({
      enrollmentId: memberEnrollments.id,
      memberId: members.id,
      memberName: members.name,
      memberKind: members.memberKind,
      seatNo: seats.seatNo,
      planId: seats.feePlanId,
      periodStart: memberEnrollments.startDate,
      periodEnd: memberEnrollments.endDate,
    })
    .from(memberEnrollments)
    .innerJoin(members, eq(members.id, memberEnrollments.memberId))
    .leftJoin(seats, eq(seats.id, members.seatId))
    .where(and(eq(members.branchId, ctx.branchId), gte(memberEnrollments.startDate, from), lte(memberEnrollments.startDate, to)))
    .orderBy(asc(memberEnrollments.startDate), asc(seats.seatNo));
  if (!rows.length) return [];

  const [plans, saved] = await Promise.all([
    db.select().from(feePlans).where(eq(feePlans.branchId, ctx.branchId)),
    db.select().from(seatPayments).where(inArray(seatPayments.enrollmentId, rows.map((r) => r.enrollmentId))),
  ]);
  const planById = new Map(plans.map((p) => [p.id, p]));
  const savedByEnrollment = new Map(saved.map((s) => [s.enrollmentId, s]));

  return rows.map((r) => {
    const hit = savedByEnrollment.get(r.enrollmentId);
    if (hit) {
      return {
        id: hit.id,
        enrollmentId: r.enrollmentId,
        memberId: r.memberId,
        memberName: r.memberName,
        seatNo: r.seatNo,
        memberKind: r.memberKind,
        periodStart: hit.periodStart,
        periodEnd: hit.periodEnd,
        planName: hit.planName,
        baseAmount: hit.baseAmount,
        discount: hit.discount,
        amount: hit.amount,
        paidAt: hit.paidAt,
        paidAmount: hit.paidAmount,
        status: hit.status,
        note: hit.note,
      };
    }
    const plan = r.planId ? planById.get(r.planId) : undefined;
    const base = plan ? (r.memberKind === "adult" ? plan.adultPrice : plan.studentPrice) : 0;
    return {
      id: null,
      enrollmentId: r.enrollmentId,
      memberId: r.memberId,
      memberName: r.memberName,
      seatNo: r.seatNo,
      memberKind: r.memberKind,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      planName: plan?.name ?? null,
      baseAmount: base,
      discount: 0,
      amount: base,
      paidAt: null,
      paidAmount: null,
      status: "pending" as const,
      note: null,
    };
  });
}

export type PaymentInput = {
  id?: string;
  enrollmentId: string;
  memberId: string;
  periodStart: string;
  periodEnd: string;
  planName?: string | null;
  baseAmount: number;
  discount: number;
  paidAt?: string | null;
  paidAmount?: number | null;
  status: SeatPaymentStatus;
  note?: string | null;
};

export async function saveSeatPayment(ctx: Ctx, input: PaymentInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...MANAGER_ROLES);
  const base = Number(input.baseAmount);
  const discount = Number(input.discount);
  if (!Number.isFinite(base) || base < 0) throw new ValidationError("금액을 확인하세요");
  if (!Number.isFinite(discount) || discount < 0) throw new ValidationError("할인 금액을 확인하세요");
  if (discount > base) throw new ValidationError("할인이 금액보다 큽니다");
  const amount = base - discount;
  // 결제일을 넣으면 완료로 본다. 결제액을 안 적었으면 청구액을 그대로 받은 것으로
  const paidAt = input.paidAt || null;
  const status: SeatPaymentStatus = input.status === "closed" ? "closed" : paidAt ? "paid" : "pending";
  const paidAmount = paidAt ? (input.paidAmount ?? amount) : (input.paidAmount ?? null);

  const vals = {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    planName: input.planName ?? null,
    baseAmount: base,
    discount,
    amount,
    paidAt,
    paidAmount,
    status,
    note: input.note?.trim() || null,
  };

  if (input.id) {
    await db.update(seatPayments).set(vals).where(and(eq(seatPayments.id, input.id), eq(seatPayments.branchId, ctx.branchId)));
    await writeAudit(db, ctx, "seat_payment", input.id, "update", null, { amount, status, paidAt });
    return input.id;
  }
  // 등록 기간과 회원이 이 지점 것이고 서로 맞는지. member_enrollments 에는 지점 열이 없어 RLS 가 막아 주지 않는다
  const [own] = await db
    .select({ id: memberEnrollments.id })
    .from(memberEnrollments)
    .innerJoin(members, eq(members.id, memberEnrollments.memberId))
    .where(and(eq(memberEnrollments.id, input.enrollmentId), eq(memberEnrollments.memberId, input.memberId), eq(members.branchId, ctx.branchId)))
    .limit(1);
  if (!own) throw new NotFoundError("이 지점 회원의 등록 기간을 찾을 수 없습니다");
  const [row] = await db
    .insert(seatPayments)
    .values({ ...vals, branchId: ctx.branchId, memberId: input.memberId, enrollmentId: input.enrollmentId })
    .onConflictDoUpdate({ target: seatPayments.enrollmentId, set: vals })
    .returning({ id: seatPayments.id });
  await writeAudit(db, ctx, "seat_payment", row.id, "create", null, { amount, status, paidAt });
  return row.id;
}

// ---------- 대시보드 요약 ----------
export type PaymentSummary = {
  seat: { pending: number; amount: number };
  meal: { pending: number; amount: number };
  total: number;
  /** 요금표나 좌석 등급이 없어 금액을 못 매긴 건 */
  unpriced: number;
};

/** 홈 화면에서 "지금 받아야 할 돈"을 좌석·식사 합쳐 한 줄로 */
export async function paymentSummary(ctx: Ctx, today = toDateKey(new Date()), db: Db = defaultDb): Promise<PaymentSummary> {
  requireRole(ctx, ...MANAGER_ROLES);
  const targets = await paymentTargets(ctx, {}, db);
  const openSeat = targets.filter((t) => t.status === "pending");
  const seatAmount = openSeat.reduce((a, t) => a + t.amount, 0);

  // 식사는 이미 월 정산에 미수가 있다
  const meals = await db
    .select({ amount: mealSettlements.amount, paidAmount: mealSettlements.paidAmount })
    .from(mealSettlements)
    .where(and(eq(mealSettlements.branchId, ctx.branchId), sql`${mealSettlements.yearMonth} <= ${today.slice(0, 7)}`));
  const mealOpen = meals.map((m) => m.amount - (m.paidAmount ?? 0)).filter((v) => v > 0);
  const mealAmount = mealOpen.reduce((a, b) => a + b, 0);

  return {
    seat: { pending: openSeat.length, amount: seatAmount },
    meal: { pending: mealOpen.length, amount: mealAmount },
    total: seatAmount + mealAmount,
    unpriced: openSeat.filter((t) => t.amount === 0).length,
  };
}
