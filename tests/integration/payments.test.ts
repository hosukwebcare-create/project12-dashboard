import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { mealSettlements, memberEnrollments } from "@/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { createMember } from "@/modules/members/repo";
import { bulkSetSeatFeePlan, listFeePlans, paymentSummary, paymentTargets, saveSeatPayment, setSeatFeePlan, upsertFeePlan } from "@/modules/payments/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

const TODAY = "2026-09-07";

/** 시트의 요금 체계를 그대로 옮긴 것: 1인실 학생 510,000 / 성인 640,000 */
async function seedPlans(ctx: Parameters<typeof upsertFeePlan>[0]) {
  const single = await upsertFeePlan(ctx, { name: "1인실", studentPrice: 510000, adultPrice: 640000, sort: 1, active: true });
  const open = await upsertFeePlan(ctx, { name: "오픈실", studentPrice: 450000, adultPrice: 580000, sort: 2, active: true });
  return { single, open };
}

describe("좌석 이용료 요금표", () => {
  beforeEach(resetDb);

  it("지점장만 요금표를 만들고, 금액은 0 이상이어야 한다", async () => {
    const t = await seedTwoBranches();
    await expect(upsertFeePlan(t.mentorCtx1, { name: "1인실", studentPrice: 1, adultPrice: 1, sort: 1, active: true })).rejects.toThrow(ForbiddenError);
    await expect(upsertFeePlan(t.mgrCtx1, { name: "", studentPrice: 1, adultPrice: 1, sort: 1, active: true })).rejects.toThrow(/등급 이름/);
    await expect(upsertFeePlan(t.mgrCtx1, { name: "1인실", studentPrice: -1, adultPrice: 1, sort: 1, active: true })).rejects.toThrow(/학생 요금/);

    await seedPlans(t.mgrCtx1);
    expect((await listFeePlans(t.mgrCtx1)).map((p) => p.name)).toEqual(["1인실", "오픈실"]);
    expect(await listFeePlans(t.mgrCtx2)).toEqual([]); // 지점마다 따로
  });

  it("좌석 번호 범위로 등급을 한 번에 지정한다", async () => {
    const t = await seedTwoBranches();
    const { single } = await seedPlans(t.mgrCtx1);
    expect(await bulkSetSeatFeePlan(t.mgrCtx1, 1, 3, single)).toBe(3);
    await expect(bulkSetSeatFeePlan(t.mgrCtx1, 5, 2, single)).rejects.toThrow(/범위/);
  });
});

describe("결제 대상", () => {
  beforeEach(resetDb);

  it("등록기간마다 좌석 등급·회원 구분으로 금액을 계산한다", async () => {
    const t = await seedTwoBranches();
    const { single } = await seedPlans(t.mgrCtx1);
    await setSeatFeePlan(t.mgrCtx1, t.seats1[0].id, single);

    const student = await createMember(t.mgrCtx1, { name: "학생회원", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false, enrollment: { startDate: TODAY, endDate: "2026-10-06" } });
    const targets = await paymentTargets(t.mgrCtx1, {}, db);
    const row = targets.find((r) => r.memberId === student)!;
    expect(row.planName).toBe("1인실");
    expect(row.amount).toBe(510000);
    expect(row.status).toBe("pending");
    expect(row.id).toBeNull(); // 아직 저장 전이라 초안
  });

  it("성인은 성인 요금을 쓴다", async () => {
    const t = await seedTwoBranches();
    const { single } = await seedPlans(t.mgrCtx1);
    await setSeatFeePlan(t.mgrCtx1, t.seats1[1].id, single);
    const adult = await createMember(t.mgrCtx1, { name: "성인회원", status: "enrolled", seatId: t.seats1[1].id, memberKind: "adult", focusCare: false, enrollment: { startDate: TODAY, endDate: "2026-10-06" } });
    const row = (await paymentTargets(t.mgrCtx1, {}, db)).find((r) => r.memberId === adult)!;
    expect(row.amount).toBe(640000);
  });

  it("등급이 없으면 금액을 못 매기고 요약에 그 수를 알린다", async () => {
    const t = await seedTwoBranches();
    await seedPlans(t.mgrCtx1);
    await createMember(t.mgrCtx1, { name: "등급없음", status: "enrolled", seatId: t.seats1[2].id, memberKind: "student", focusCare: false, enrollment: { startDate: TODAY, endDate: "2026-10-06" } });
    const row = (await paymentTargets(t.mgrCtx1, {}, db))[0];
    expect(row.planName).toBeNull();
    expect(row.amount).toBe(0);
    expect((await paymentSummary(t.mgrCtx1, TODAY, db)).unpriced).toBe(1);
  });

  it("저장하면 할인이 빠지고, 결제일을 넣으면 완료가 된다", async () => {
    const t = await seedTwoBranches();
    const { single } = await seedPlans(t.mgrCtx1);
    await setSeatFeePlan(t.mgrCtx1, t.seats1[0].id, single);
    const m = await createMember(t.mgrCtx1, { name: "가나", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false, enrollment: { startDate: TODAY, endDate: "2026-10-06" } });
    const [enr] = await db.select().from(memberEnrollments).where(eq(memberEnrollments.memberId, m));

    // 친구할인 50,000
    await saveSeatPayment(t.mgrCtx1, { enrollmentId: enr.id, memberId: m, periodStart: TODAY, periodEnd: "2026-10-06", planName: "1인실", baseAmount: 510000, discount: 50000, status: "pending" });
    let row = (await paymentTargets(t.mgrCtx1, {}, db))[0];
    expect(row.amount).toBe(460000);
    expect(row.status).toBe("pending");
    expect(row.id).not.toBeNull();

    // 결제일을 넣으면 완료, 결제액은 청구액으로 채워진다
    await saveSeatPayment(t.mgrCtx1, { id: row.id!, enrollmentId: enr.id, memberId: m, periodStart: TODAY, periodEnd: "2026-10-06", planName: "1인실", baseAmount: 510000, discount: 50000, paidAt: "2026-09-08", status: "pending" });
    row = (await paymentTargets(t.mgrCtx1, {}, db))[0];
    expect(row.status).toBe("paid");
    expect(row.paidAmount).toBe(460000);
  });

  it("할인이 금액보다 크면 거절한다", async () => {
    const t = await seedTwoBranches();
    const m = await createMember(t.mgrCtx1, { name: "가나", status: "enrolled", memberKind: "student", focusCare: false, enrollment: { startDate: TODAY, endDate: "2026-10-06" } });
    const [enr] = await db.select().from(memberEnrollments).where(eq(memberEnrollments.memberId, m));
    await expect(
      saveSeatPayment(t.mgrCtx1, { enrollmentId: enr.id, memberId: m, periodStart: TODAY, periodEnd: "2026-10-06", baseAmount: 100000, discount: 200000, status: "pending" }),
    ).rejects.toThrow(/할인이 금액보다/);
  });

  it("요약은 좌석 미납과 식사 미수를 합친다", async () => {
    const t = await seedTwoBranches();
    const { single } = await seedPlans(t.mgrCtx1);
    await setSeatFeePlan(t.mgrCtx1, t.seats1[0].id, single);
    const m = await createMember(t.mgrCtx1, { name: "가나", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false, enrollment: { startDate: TODAY, endDate: "2026-10-06" } });
    // 식사 미수 24,000 (8,000 × 3식 중 미납)
    await db.insert(mealSettlements).values({ branchId: t.b1.id, memberId: m, yearMonth: "2026-09", mealCount: 3, amount: 24000, paidAmount: 0 });

    const sum = await paymentSummary(t.mgrCtx1, TODAY, db);
    expect(sum.seat).toEqual({ pending: 1, amount: 510000 });
    expect(sum.meal).toEqual({ pending: 1, amount: 24000 });
    expect(sum.total).toBe(534000);
  });

  it("멘토·조교는 결제 화면을 볼 수 없다", async () => {
    const t = await seedTwoBranches();
    await expect(paymentTargets(t.mentorCtx1, {}, db)).rejects.toThrow(ForbiddenError);
    await expect(paymentSummary(t.asstCtx1, TODAY, db)).rejects.toThrow(ForbiddenError);
  });
});
