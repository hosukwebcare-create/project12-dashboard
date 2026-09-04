import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db as defaultDb, type Db, type Tx } from "@/db/client";
import { mealOrders, mealSettings, mealSettlements, members, seats, type MealKind, type MealSettingsRow } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { MANAGER_ROLES, requireRole, type Ctx, type Role } from "@/lib/auth/ctx";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isMealAvailable, isOrderLocked, isValidCutoff, monthDates, type MealPolicy } from "@/lib/rules/meals";

const ORDER_ROLES: Role[] = ["hq_admin", "branch_manager", "assistant"];

export async function getMealSettings(ctx: Pick<Ctx, "branchId">, db: Db | Tx = defaultDb): Promise<MealSettingsRow> {
  const [row] = await db.select().from(mealSettings).where(eq(mealSettings.branchId, ctx.branchId)).limit(1);
  if (row) return row;
  const [created] = await db.insert(mealSettings).values({ branchId: ctx.branchId }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await db.select().from(mealSettings).where(eq(mealSettings.branchId, ctx.branchId)).limit(1);
  return again;
}

export type MealSettingsPatch = Partial<Pick<MealSettingsRow, "lunchPrice" | "dinnerPrice" | "cutoffTime" | "saturdayLunchOnly" | "sundayClosed" | "closedDates" | "vendorName" | "vendorPhone">>;

export async function updateMealSettings(ctx: Ctx, patch: MealSettingsPatch, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...MANAGER_ROLES);
  if (patch.cutoffTime !== undefined && !isValidCutoff(patch.cutoffTime)) throw new ValidationError("마감 시각은 HH:mm 형식");
  for (const k of ["lunchPrice", "dinnerPrice"] as const) {
    const v = patch[k];
    if (v !== undefined && (!Number.isInteger(v) || v < 0)) throw new ValidationError("단가는 0 이상의 정수");
  }
  if (patch.closedDates) {
    const bad = patch.closedDates.find((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d));
    if (bad) throw new ValidationError(`휴무일 형식 오류: ${bad}`);
  }
  await db.transaction(async (tx) => {
    const before = await getMealSettings(ctx, tx);
    await tx.update(mealSettings).set(patch).where(eq(mealSettings.branchId, ctx.branchId));
    await writeAudit(tx, ctx, "meal_settings", before.id, "update", before, { ...before, ...patch });
  });
}

function policyOf(s: MealSettingsRow): MealPolicy {
  return { cutoffTime: s.cutoffTime, saturdayLunchOnly: s.saturdayLunchOnly, sundayClosed: s.sundayClosed, closedDates: s.closedDates };
}

export type OrderInput = { memberId: string; date: string; meal: MealKind; ordered: boolean; overrideReason?: string };

export async function setOrder(ctx: Ctx, input: OrderInput, now: Date = new Date(), db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...ORDER_ROLES);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ValidationError("날짜 형식 오류");
  await db.transaction(async (tx) => {
    const [m] = await tx.select({ id: members.id, name: members.name }).from(members).where(and(eq(members.id, input.memberId), eq(members.branchId, ctx.branchId))).limit(1);
    if (!m) throw new NotFoundError("회원을 찾을 수 없습니다");
    const settings = await getMealSettings(ctx, tx);
    if (!isMealAvailable(input.date, input.meal, policyOf(settings))) throw new ValidationError("이 날짜·끼니는 주문할 수 없습니다 (요일·휴무 정책)");
    const locked = isOrderLocked(input.date, settings.cutoffTime, now);
    if (locked) {
      if (!MANAGER_ROLES.includes(ctx.role)) throw new ValidationError("마감된 날짜입니다 (전일 " + settings.cutoffTime + " 이후 변경 불가)");
      if (!input.overrideReason?.trim()) throw new ValidationError("마감 후 변경은 사유를 입력해야 합니다");
    }
    const price = input.meal === "lunch" ? settings.lunchPrice : settings.dinnerPrice;
    const [before] = await tx
      .select()
      .from(mealOrders)
      .where(and(eq(mealOrders.memberId, input.memberId), eq(mealOrders.date, input.date), eq(mealOrders.meal, input.meal)))
      .limit(1);
    const values = {
      branchId: ctx.branchId,
      memberId: input.memberId,
      date: input.date,
      meal: input.meal,
      ordered: input.ordered,
      // 이미 주문된 건을 취소·재주문할 때는 처음 단가를 유지한다
      priceSnapshot: before?.priceSnapshot ?? price,
      changedBy: ctx.userId,
      changedAt: now,
    };
    const [row] = await tx
      .insert(mealOrders)
      .values(values)
      .onConflictDoUpdate({ target: [mealOrders.memberId, mealOrders.date, mealOrders.meal], set: { ordered: values.ordered, changedBy: values.changedBy, changedAt: values.changedAt } })
      .returning({ id: mealOrders.id });
    if (locked) {
      await writeAudit(tx, ctx, "meal_order", row.id, "update", { ordered: before?.ordered ?? null }, { ordered: input.ordered, reason: input.overrideReason, member: m.name, date: input.date, meal: input.meal });
    }
  });
}

export type MealDay = { date: string; lunch: boolean; dinner: boolean; locked: boolean; dow: number };
export type MealGrid = {
  yearMonth: string;
  settings: MealSettingsRow;
  days: MealDay[];
  rows: { memberId: string; name: string; seatNo: number | null; orders: Record<string, { lunch: boolean; dinner: boolean }> }[];
  totals: Record<string, { lunch: number; dinner: number }>;
};

export async function monthGrid(ctx: Ctx, yearMonth: string, now: Date = new Date(), db: Db = defaultDb): Promise<MealGrid> {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new ValidationError("월 형식 오류");
  const settings = await getMealSettings(ctx, db);
  const policy = policyOf(settings);
  const dates = monthDates(yearMonth);
  const days: MealDay[] = dates.map((date) => ({
    date,
    lunch: isMealAvailable(date, "lunch", policy),
    dinner: isMealAvailable(date, "dinner", policy),
    locked: isOrderLocked(date, settings.cutoffTime, now),
    dow: new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))).getDay(),
  }));
  const memberRows = await db
    .select({ memberId: members.id, name: members.name, seatNo: seats.seatNo })
    .from(members)
    .leftJoin(seats, eq(seats.id, members.seatId))
    .where(and(eq(members.branchId, ctx.branchId), inArray(members.status, ["enrolled", "paused"])))
    .orderBy(sql`${seats.seatNo} asc nulls last`, asc(members.name));
  const orders = await db
    .select({ memberId: mealOrders.memberId, date: mealOrders.date, meal: mealOrders.meal, ordered: mealOrders.ordered })
    .from(mealOrders)
    .where(and(eq(mealOrders.branchId, ctx.branchId), gte(mealOrders.date, dates[0]), lte(mealOrders.date, dates[dates.length - 1]), eq(mealOrders.ordered, true)));
  const byMember = new Map<string, Record<string, { lunch: boolean; dinner: boolean }>>();
  const totals: Record<string, { lunch: number; dinner: number }> = {};
  for (const d of dates) totals[d] = { lunch: 0, dinner: 0 };
  for (const o of orders) {
    const m = byMember.get(o.memberId) ?? {};
    m[o.date] = { ...(m[o.date] ?? { lunch: false, dinner: false }), [o.meal]: true };
    byMember.set(o.memberId, m);
    if (totals[o.date]) totals[o.date][o.meal] += 1;
  }
  return { yearMonth, settings, days, rows: memberRows.map((r) => ({ ...r, orders: byMember.get(r.memberId) ?? {} })), totals };
}

export async function dailyOrders(ctx: Ctx, date: string, db: Db = defaultDb) {
  const rows = await db
    .select({ memberId: members.id, name: members.name, seatNo: seats.seatNo, meal: mealOrders.meal })
    .from(mealOrders)
    .innerJoin(members, eq(members.id, mealOrders.memberId))
    .leftJoin(seats, eq(seats.id, members.seatId))
    .where(and(eq(mealOrders.branchId, ctx.branchId), eq(mealOrders.date, date), eq(mealOrders.ordered, true)))
    .orderBy(sql`${seats.seatNo} asc nulls last`, asc(members.name));
  const map = new Map<string, { memberId: string; name: string; seatNo: number | null; lunch: boolean; dinner: boolean }>();
  for (const r of rows) {
    const cur = map.get(r.memberId) ?? { memberId: r.memberId, name: r.name, seatNo: r.seatNo, lunch: false, dinner: false };
    cur[r.meal] = true;
    map.set(r.memberId, cur);
  }
  const list = [...map.values()];
  return { date, rows: list, totals: { lunch: list.filter((r) => r.lunch).length, dinner: list.filter((r) => r.dinner).length } };
}

export type SettlementRow = { memberId: string; name: string; seatNo: number | null; mealCount: number; amount: number; paidAt: string | null; paidAmount: number | null; balance: number; note: string | null };

/** 주문 기록으로 월 정산을 다시 계산해 저장하고 돌려준다 */
export async function monthlySettlement(ctx: Ctx, yearMonth: string, db: Db = defaultDb): Promise<{ yearMonth: string; rows: SettlementRow[]; totals: { mealCount: number; amount: number; paidAmount: number } }> {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new ValidationError("월 형식 오류");
  const dates = monthDates(yearMonth);
  const agg = await db
    .select({ memberId: mealOrders.memberId, n: sql<number>`count(*)`, amount: sql<number>`coalesce(sum(${mealOrders.priceSnapshot}), 0)` })
    .from(mealOrders)
    .where(and(eq(mealOrders.branchId, ctx.branchId), gte(mealOrders.date, dates[0]), lte(mealOrders.date, dates[dates.length - 1]), eq(mealOrders.ordered, true)))
    .groupBy(mealOrders.memberId);
  await db.transaction(async (tx) => {
    for (const a of agg) {
      await tx
        .insert(mealSettlements)
        .values({ branchId: ctx.branchId, memberId: a.memberId, yearMonth, mealCount: Number(a.n), amount: Number(a.amount) })
        .onConflictDoUpdate({ target: [mealSettlements.memberId, mealSettlements.yearMonth], set: { mealCount: Number(a.n), amount: Number(a.amount) } });
    }
  });
  const rows = await db
    .select({ s: mealSettlements, name: members.name, seatNo: seats.seatNo })
    .from(mealSettlements)
    .innerJoin(members, eq(members.id, mealSettlements.memberId))
    .leftJoin(seats, eq(seats.id, members.seatId))
    .where(and(eq(mealSettlements.branchId, ctx.branchId), eq(mealSettlements.yearMonth, yearMonth)))
    .orderBy(sql`${seats.seatNo} asc nulls last`, asc(members.name));
  const list: SettlementRow[] = rows
    .filter((r) => r.s.mealCount > 0 || r.s.paidAmount)
    .map((r) => ({
      memberId: r.s.memberId,
      name: r.name,
      seatNo: r.seatNo,
      mealCount: r.s.mealCount,
      amount: r.s.amount,
      paidAt: r.s.paidAt,
      paidAmount: r.s.paidAmount,
      balance: r.s.amount - (r.s.paidAmount ?? 0),
      note: r.s.note,
    }));
  return {
    yearMonth,
    rows: list,
    totals: { mealCount: list.reduce((a, r) => a + r.mealCount, 0), amount: list.reduce((a, r) => a + r.amount, 0), paidAmount: list.reduce((a, r) => a + (r.paidAmount ?? 0), 0) },
  };
}

export async function markSettlementPaid(ctx: Ctx, input: { memberId: string; yearMonth: string; paidAt: string | null; paidAmount: number | null; note: string | null }, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...MANAGER_ROLES);
  if (input.paidAt && !/^\d{4}-\d{2}-\d{2}$/.test(input.paidAt)) throw new ValidationError("결제일 형식은 YYYY-MM-DD");
  const [row] = await db
    .select()
    .from(mealSettlements)
    .where(and(eq(mealSettlements.branchId, ctx.branchId), eq(mealSettlements.memberId, input.memberId), eq(mealSettlements.yearMonth, input.yearMonth)))
    .limit(1);
  if (!row) throw new NotFoundError("정산 행을 찾을 수 없습니다. 먼저 정산을 집계하세요");
  await db.transaction(async (tx) => {
    await tx.update(mealSettlements).set({ paidAt: input.paidAt, paidAmount: input.paidAmount, note: input.note }).where(eq(mealSettlements.id, row.id));
    await writeAudit(tx, ctx, "meal_settlement", row.id, "update", { paidAt: row.paidAt, paidAmount: row.paidAmount }, { paidAt: input.paidAt, paidAmount: input.paidAmount });
  });
}

export function assertOrderRole(ctx: Ctx) {
  if (!ORDER_ROLES.includes(ctx.role)) throw new ForbiddenError();
}
