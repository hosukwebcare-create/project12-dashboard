import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { boardItems, branches } from "@/db/schema";
import { boardData, issueBoardToken, verifyBoardToken } from "@/modules/board/repo";
import { createMember } from "@/modules/members/repo";
import { startSession, upsertCheck } from "@/modules/rounding/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

const WEEK = "2026-08-31";

async function seedBoard() {
  const t = await seedTwoBranches();
  await db.insert(boardItems).values([
    { key: "attendance", label: "출석", kind: "daily", sort: 1 },
    { key: "round", label: "라운딩", kind: "round", sort: 2 },
    { key: "vocab", label: "영단어", kind: "daily", sort: 3 },
  ]);
  const a = await createMember(t.mgrCtx1, { name: "김지민", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false, phone: "010-0000-0001" });
  const b = await createMember(t.mgrCtx1, { name: "박서준", status: "enrolled", seatId: t.seats1[2].id, memberKind: "student", focusCare: false });
  return { ...t, a, b };
}

describe("현황판 토큰", () => {
  beforeEach(resetDb);

  it("발급한 토큰만 검증을 통과하고 재발급하면 이전 토큰은 무효", async () => {
    const t = await seedBoard();
    const token = await issueBoardToken(t.mgrCtx1);
    expect(await verifyBoardToken(t.b1.id, token)).toBe(true);
    expect(await verifyBoardToken(t.b1.id, token + "x")).toBe(false);
    expect(await verifyBoardToken(t.b2.id, token)).toBe(false);
    const token2 = await issueBoardToken(t.mgrCtx1);
    expect(await verifyBoardToken(t.b1.id, token)).toBe(false);
    expect(await verifyBoardToken(t.b1.id, token2)).toBe(true);
  });

  it("멘토는 토큰을 발급할 수 없다", async () => {
    const t = await seedBoard();
    await expect(issueBoardToken(t.mentorCtx1)).rejects.toThrow();
  });
});

describe("현황판 데이터", () => {
  beforeEach(resetDb);

  it("좌석 순 회원, 항목, 규칙, 셀, 주간 벌점 합계를 준다 (개인정보 없음)", async () => {
    const t = await seedBoard();
    const sid = await startSession(t.asstCtx1, "2026-09-01");
    const sleepy = t.rules.find((r) => r.name === "졸음")!;
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: "2026-09-01", itemKey: "round", roundNo: 1, sessionId: sid, grade: "p", penaltyRuleId: sleepy.id });
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: "2026-09-01", itemKey: "attendance", roundNo: 0, grade: "a" });
    await upsertCheck(t.asstCtx1, { memberId: t.b, date: "2026-09-02", itemKey: "vocab", roundNo: 0, grade: "b" });
    // 다른 주의 벌점은 합계에 들어가지 않는다
    await upsertCheck(t.asstCtx1, { memberId: t.a, date: "2026-08-30", itemKey: "attendance", roundNo: 0, grade: "p", penaltyRuleId: sleepy.id });

    const data = await boardData(t.b1.id, WEEK);
    expect(data.branchName).toBe("지점1");
    expect(data.days).toEqual(["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
    expect(data.items.map((i) => i.key)).toEqual(["attendance", "round", "vocab"]);
    expect(data.rules.map((r) => `${r.name}${r.points}`)).toEqual(["졸음3", "지각4", "이동금지 위반5"]);
    expect(data.roundsPerDay).toBe(12);
    expect(data.seats.map((s) => [s.seatNo, s.name, s.weeklyPoints])).toEqual([
      [1, "김지민", 3],
      [3, "박서준", 0],
    ]);
    expect(data.cells["1|2026-09-01|round|1"]).toEqual({ grade: "p", points: 3 });
    expect(data.cells["1|2026-09-01|attendance|0"]).toEqual({ grade: "a", points: 0 });
    expect(data.cells["3|2026-09-02|vocab|0"]).toEqual({ grade: "b", points: 0 });
    expect(JSON.stringify(data)).not.toContain("010-0000");
  });

  it("maskNames 설정이면 이름을 가린다", async () => {
    const t = await seedBoard();
    await db.update(branches).set({ settings: { roundsPerDay: 12, maskNames: true } }).where(eq(branches.id, t.b1.id));
    const data = await boardData(t.b1.id, WEEK);
    expect(data.seats.map((s) => s.name)).toEqual(["김*민", "박*준"]);
  });

  it("주 시작일이 월요일이 아니면 해당 주의 월요일로 맞춘다", async () => {
    const t = await seedBoard();
    const data = await boardData(t.b1.id, "2026-09-03");
    expect(data.weekStart).toBe(WEEK);
  });
});
