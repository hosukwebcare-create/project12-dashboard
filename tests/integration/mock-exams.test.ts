import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createMember } from "@/modules/members/repo";
import { listRounds, roundGrid, upsertApplication, upsertRound } from "@/modules/mock-exams/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

describe("모의고사", () => {
  beforeEach(resetDb);

  it("회차를 만들고 신청·결제를 기록하면 계열별 집계가 나온다", async () => {
    const t = await seedTwoBranches();
    const a = await createMember(t.mgrCtx1, { name: "가", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false, track: "문과" });
    const b = await createMember(t.mgrCtx1, { name: "나", status: "enrolled", seatId: t.seats1[1].id, memberKind: "student", focusCare: false, track: "이과" });
    await createMember(t.mgrCtx1, { name: "다", status: "prospect", memberKind: "student", focusCare: false });

    const roundId = await upsertRound(t.mgrCtx1, { yearMonth: "2026-09", name: "9월 모의고사", price: 29000 });
    await expect(upsertRound(t.mgrCtx1, { yearMonth: "2026-09", name: "9월 모의고사", price: 29000 })).rejects.toThrow(ValidationError);
    expect((await listRounds(t.mgrCtx1)).map((r) => r.name)).toEqual(["9월 모의고사"]);
    expect(await listRounds(t.mgrCtx2)).toEqual([]);

    await upsertApplication(t.mgrCtx1, { roundId, memberId: a, applied: true, track: "문과", subjects: "화작·확통·세지·사문", paidAt: "2026-09-03", paidAmount: 29000, note: null });
    await upsertApplication(t.mgrCtx1, { roundId, memberId: b, applied: true, track: "이과", subjects: "언매·미적·생명·지구", paidAt: null, paidAmount: null, note: "결제 예정" });

    const grid = await roundGrid(t.mgrCtx1, roundId);
    expect(grid.round.name).toBe("9월 모의고사");
    // 등록 회원만 (상담 회원 제외), 좌석 순
    expect(grid.rows.map((r) => [r.name, r.applied, r.paidAt])).toEqual([
      ["가", true, "2026-09-03"],
      ["나", true, null],
    ]);
    expect(grid.summary).toEqual({ applied: 2, paid: 1, unpaid: 1, byTrack: { 문과: 1, 이과: 1 }, expectedAmount: 58000, paidAmount: 29000 });
    expect((await listRounds(t.mgrCtx1))[0].appliedCount).toBe(2);

    // 결제일만 넣으면 응시료가 결제액이 된다
    await upsertApplication(t.mgrCtx1, { roundId, memberId: b, applied: true, track: "이과", subjects: null, paidAt: "2026-09-04", paidAmount: null, note: null });
    expect((await roundGrid(t.mgrCtx1, roundId)).summary.paidAmount).toBe(58000);

    // 신청 취소
    await upsertApplication(t.mgrCtx1, { roundId, memberId: b, applied: false, track: null, subjects: null, paidAt: null, paidAmount: null, note: null });
    expect((await roundGrid(t.mgrCtx1, roundId)).summary.applied).toBe(1);
  });

  it("타 지점 회차·회원에는 접근할 수 없고 멘토는 읽기만", async () => {
    const t = await seedTwoBranches();
    const a = await createMember(t.mgrCtx1, { name: "가", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false });
    const roundId = await upsertRound(t.mgrCtx1, { yearMonth: "2026-09", name: "9월", price: 29000 });
    await expect(roundGrid(t.mgrCtx2, roundId)).rejects.toThrow(NotFoundError);
    await expect(upsertApplication(t.mgrCtx2, { roundId, memberId: a, applied: true, track: null, subjects: null, paidAt: null, paidAmount: null, note: null })).rejects.toThrow(NotFoundError);
    await expect(upsertApplication(t.mentorCtx1, { roundId, memberId: a, applied: true, track: null, subjects: null, paidAt: null, paidAmount: null, note: null })).rejects.toThrow(ForbiddenError);
    expect((await roundGrid(t.mentorCtx1, roundId)).rows).toHaveLength(1);
    await expect(upsertRound(t.asstCtx1, { yearMonth: "2026-10", name: "10월", price: 0 })).rejects.toThrow(ForbiddenError);
  });
});
