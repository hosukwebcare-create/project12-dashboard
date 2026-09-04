import { db } from "@/db/client";
import { branches, memberships, penaltyRules, seats, users } from "@/db/schema";
import { buildCtx, type Ctx } from "@/lib/auth/ctx";

/** 지점 2개, 각 지점 좌석 5개, 역할별 사용자 컨텍스트를 만든다 */
export async function seedTwoBranches() {
  const [b1] = await db.insert(branches).values({ code: "B1", name: "지점1" }).returning();
  const [b2] = await db.insert(branches).values({ code: "B2", name: "지점2" }).returning();
  const s1 = await db
    .insert(seats)
    .values(Array.from({ length: 5 }, (_, i) => ({ branchId: b1.id, seatNo: i + 1, zone: "A", sort: i + 1 })))
    .returning();
  const s2 = await db
    .insert(seats)
    .values(Array.from({ length: 5 }, (_, i) => ({ branchId: b2.id, seatNo: i + 1, zone: "A", sort: i + 1 })))
    .returning();

  const mk = async (loginId: string, name: string, isHqAdmin = false) =>
    (await db.insert(users).values({ loginId, name, passwordHash: "x", isHqAdmin }).returning())[0];
  const hq = await mk("hq", "본사", true);
  const mgr1 = await mk("mgr1", "지점장1");
  const mentor1 = await mk("mentor1", "멘토1");
  const asst1 = await mk("asst1", "조교1");
  const mgr2 = await mk("mgr2", "지점장2");
  await db.insert(memberships).values([
    { userId: mgr1.id, branchId: b1.id, role: "branch_manager" },
    { userId: mentor1.id, branchId: b1.id, role: "mentor" },
    { userId: asst1.id, branchId: b1.id, role: "assistant" },
    { userId: mgr2.id, branchId: b2.id, role: "branch_manager" },
  ]);

  const rules = await db
    .insert(penaltyRules)
    .values([
      { name: "졸음", points: 3, sort: 1 },
      { name: "지각", points: 4, sort: 2 },
      { name: "이동금지 위반", points: 5, sort: 3 },
    ])
    .returning();

  const ctx = async (userId: string, branchId: string) => (await buildCtx(userId, branchId)) as Ctx;
  return {
    b1,
    b2,
    seats1: s1,
    seats2: s2,
    users: { hq, mgr1, mentor1, asst1, mgr2 },
    rules,
    hqCtx1: await ctx(hq.id, b1.id),
    mgrCtx1: await ctx(mgr1.id, b1.id),
    mentorCtx1: await ctx(mentor1.id, b1.id),
    asstCtx1: await ctx(asst1.id, b1.id),
    mgrCtx2: await ctx(mgr2.id, b2.id),
  };
}
