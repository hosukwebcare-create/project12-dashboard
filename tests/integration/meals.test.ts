import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { dailyOrders, getMealSettings, markSettlementPaid, monthGrid, monthlySettlement, setOrder, updateMealSettings } from "@/modules/meals/repo";
import { createMember } from "@/modules/members/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

const NOW = new Date(2026, 8, 5, 10, 0); // 2026-09-05 10:00 (토)

async function seedMeals() {
  const t = await seedTwoBranches();
  const a = await createMember(t.mgrCtx1, { name: "가", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false });
  const b = await createMember(t.mgrCtx1, { name: "나", status: "enrolled", seatId: t.seats1[1].id, memberKind: "student", focusCare: false });
  return { ...t, a, b };
}

describe("식사 설정", () => {
  beforeEach(resetDb);

  it("설정이 없으면 기본값을 만들고, 지점장이 바꿀 수 있다", async () => {
    const t = await seedMeals();
    const s = await getMealSettings(t.mgrCtx1);
    expect(s).toMatchObject({ lunchPrice: 8000, dinnerPrice: 8000, cutoffTime: "23:59", saturdayLunchOnly: true, sundayClosed: true });
    await updateMealSettings(t.mgrCtx1, { lunchPrice: 9000, closedDates: ["2026-09-15"], vendorName: "행복도시락" });
    expect(await getMealSettings(t.mgrCtx1)).toMatchObject({ lunchPrice: 9000, dinnerPrice: 8000, closedDates: ["2026-09-15"], vendorName: "행복도시락" });
    await expect(updateMealSettings(t.asstCtx1, { lunchPrice: 1 })).rejects.toThrow(ForbiddenError);
    await expect(updateMealSettings(t.mgrCtx1, { cutoffTime: "25:00" })).rejects.toThrow(ValidationError);
  });
});

describe("식사 주문", () => {
  beforeEach(resetDb);

  it("조교가 주문을 넣고 단가가 스냅샷된다", async () => {
    const t = await seedMeals();
    await setOrder(t.asstCtx1, { memberId: t.a, date: "2026-09-08", meal: "lunch", ordered: true }, NOW);
    await setOrder(t.asstCtx1, { memberId: t.a, date: "2026-09-08", meal: "dinner", ordered: true }, NOW);
    await updateMealSettings(t.mgrCtx1, { lunchPrice: 9000 });
    await setOrder(t.asstCtx1, { memberId: t.b, date: "2026-09-08", meal: "lunch", ordered: true }, NOW);
    const day = await dailyOrders(t.mgrCtx1, "2026-09-08");
    expect(day.totals).toEqual({ lunch: 2, dinner: 1 });
    expect(day.rows.map((r) => [r.name, r.lunch, r.dinner])).toEqual([
      ["가", true, true],
      ["나", true, false],
    ]);
    const grid = await monthGrid(t.mgrCtx1, "2026-09", NOW);
    const a = grid.rows.find((r) => r.memberId === t.a)!;
    expect(a.orders["2026-09-08"]).toEqual({ lunch: true, dinner: true });
    expect(grid.totals["2026-09-08"]).toEqual({ lunch: 2, dinner: 1 });
    // 단가 스냅샷: 가 8000, 나 9000
    const st = await monthlySettlement(t.mgrCtx1, "2026-09");
    expect(st.rows.map((r) => [r.name, r.mealCount, r.amount])).toEqual([
      ["가", 2, 16000],
      ["나", 1, 9000],
    ]);
  });

  it("마감 지난 날짜는 조교가 바꿀 수 없고, 지점장은 사유와 함께 바꿀 수 있다", async () => {
    const t = await seedMeals();
    await expect(setOrder(t.asstCtx1, { memberId: t.a, date: "2026-09-05", meal: "lunch", ordered: true }, NOW)).rejects.toThrow(/마감/);
    await expect(setOrder(t.mgrCtx1, { memberId: t.a, date: "2026-09-05", meal: "lunch", ordered: true }, NOW)).rejects.toThrow(/사유/);
    await setOrder(t.mgrCtx1, { memberId: t.a, date: "2026-09-05", meal: "lunch", ordered: true, overrideReason: "업체에 전화로 추가" }, NOW);
    expect((await dailyOrders(t.mgrCtx1, "2026-09-05")).totals.lunch).toBe(1);
  });

  it("토요일 석식·일요일·휴무일은 주문할 수 없다", async () => {
    const t = await seedMeals();
    await updateMealSettings(t.mgrCtx1, { closedDates: ["2026-09-15"] });
    await expect(setOrder(t.asstCtx1, { memberId: t.a, date: "2026-09-12", meal: "dinner", ordered: true }, NOW)).rejects.toThrow(/주문할 수 없/);
    await expect(setOrder(t.asstCtx1, { memberId: t.a, date: "2026-09-13", meal: "lunch", ordered: true }, NOW)).rejects.toThrow(/주문할 수 없/);
    await expect(setOrder(t.asstCtx1, { memberId: t.a, date: "2026-09-15", meal: "lunch", ordered: true }, NOW)).rejects.toThrow(/주문할 수 없/);
    const grid = await monthGrid(t.mgrCtx1, "2026-09", NOW);
    expect(grid.days.find((d) => d.date === "2026-09-12")).toMatchObject({ lunch: true, dinner: false, locked: false });
    expect(grid.days.find((d) => d.date === "2026-09-13")).toMatchObject({ lunch: false, dinner: false });
    expect(grid.days.find((d) => d.date === "2026-09-04")).toMatchObject({ locked: true });
  });

  it("타 지점 회원은 주문할 수 없고 멘토는 입력할 수 없다", async () => {
    const t = await seedMeals();
    await expect(setOrder(t.mgrCtx2, { memberId: t.a, date: "2026-09-08", meal: "lunch", ordered: true }, NOW)).rejects.toThrow();
    await expect(setOrder(t.mentorCtx1, { memberId: t.a, date: "2026-09-08", meal: "lunch", ordered: true }, NOW)).rejects.toThrow(ForbiddenError);
  });
});

describe("월 정산", () => {
  beforeEach(resetDb);

  it("정산 집계 후 결제 처리하면 잔액이 남지 않는다", async () => {
    const t = await seedMeals();
    await setOrder(t.asstCtx1, { memberId: t.a, date: "2026-09-08", meal: "lunch", ordered: true }, NOW);
    await setOrder(t.asstCtx1, { memberId: t.a, date: "2026-09-09", meal: "lunch", ordered: true }, NOW);
    await setOrder(t.asstCtx1, { memberId: t.a, date: "2026-09-09", meal: "lunch", ordered: false }, NOW); // 취소
    const st = await monthlySettlement(t.mgrCtx1, "2026-09");
    expect(st.rows.find((r) => r.memberId === t.a)).toMatchObject({ mealCount: 1, amount: 8000, paidAmount: null, balance: 8000 });
    expect(st.totals).toEqual({ mealCount: 1, amount: 8000, paidAmount: 0 });
    await markSettlementPaid(t.mgrCtx1, { memberId: t.a, yearMonth: "2026-09", paidAt: "2026-10-02", paidAmount: 8000, note: "계좌이체" });
    const after = await monthlySettlement(t.mgrCtx1, "2026-09");
    expect(after.rows.find((r) => r.memberId === t.a)).toMatchObject({ paidAt: "2026-10-02", paidAmount: 8000, balance: 0, note: "계좌이체" });
    await expect(markSettlementPaid(t.asstCtx1, { memberId: t.a, yearMonth: "2026-09", paidAt: "2026-10-02", paidAmount: 8000, note: null })).rejects.toThrow(ForbiddenError);
  });
});
