import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { branches, checks, members, seats } from "@/db/schema";
import { resetDb } from "./setup";

async function makeBranchWithSeat() {
  const [b] = await db.insert(branches).values({ code: "T1", name: "테스트지점" }).returning();
  const [s] = await db.insert(seats).values({ branchId: b.id, seatNo: 1, zone: "A", sort: 1 }).returning();
  return { b, s };
}

describe("스키마 제약", () => {
  beforeEach(resetDb);

  it("등록 상태 회원 두 명이 같은 좌석을 가질 수 없다", async () => {
    const { b, s } = await makeBranchWithSeat();
    await db.insert(members).values({ branchId: b.id, seatId: s.id, name: "회원일", status: "enrolled" });
    await expect(
      db.insert(members).values({ branchId: b.id, seatId: s.id, name: "회원이", status: "enrolled" }),
    ).rejects.toThrow();
  });

  it("퇴원 회원은 같은 좌석 id를 이력으로 가질 수 있다(부분 유니크)", async () => {
    const { b, s } = await makeBranchWithSeat();
    await db.insert(members).values({ branchId: b.id, seatId: s.id, name: "회원일", status: "enrolled" });
    await expect(
      db.insert(members).values({ branchId: b.id, seatId: s.id, name: "회원이", status: "withdrawn" }),
    ).resolves.toBeDefined();
  });

  it("같은 지점에 같은 좌석번호를 두 번 만들 수 없다", async () => {
    const { b } = await makeBranchWithSeat();
    await expect(db.insert(seats).values({ branchId: b.id, seatNo: 1, zone: "B", sort: 2 })).rejects.toThrow();
  });

  it("checks는 회원·일자·항목·회차 조합이 유일하다", async () => {
    const { b, s } = await makeBranchWithSeat();
    const [m] = await db
      .insert(members)
      .values({ branchId: b.id, seatId: s.id, name: "회원일", status: "enrolled" })
      .returning();
    const base = { branchId: b.id, memberId: m.id, seatNoSnapshot: 1, date: "2026-09-01", itemKey: "round", roundNo: 1, grade: "a" as const };
    await db.insert(checks).values(base);
    await expect(db.insert(checks).values(base)).rejects.toThrow();
    // 다른 회차는 허용
    await expect(db.insert(checks).values({ ...base, roundNo: 2 })).resolves.toBeDefined();
  });
});
