import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte, sql, sum } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { checks, memberEnrollments, members, roundingSessions, seats } from "@/db/schema";
import type { Ctx } from "@/lib/auth/ctx";
import { daysLeft } from "@/lib/rules/enrollment";
import { addDays, toDateKey, weekDays, weekStart } from "@/lib/rules/week";
import { missingWeeklyCount } from "@/modules/counsel/repo";
import { listIssues, type IssueRow } from "@/modules/issues/repo";

export type DashboardData = {
  weekStart: string;
  sessionsDone: number;
  /** 오늘 완료한 회차 번호 */
  completedRounds: number[];
  roundsPerDay: number;
  openIssues: IssueRow[];
  topPenalties: { memberId: string; name: string; seatNo: number | null; points: number }[];
  missingWeekly: number;
  expiring: { memberId: string; name: string; seatNo: number | null; endDate: string; daysLeft: number }[];
  /** 오늘까지 7일, 날마다 완료한 회차 수. 이번 주 라운딩이 실제로 돌았는지 한눈에 본다 */
  recentRounds: { date: string; done: number }[];
};

export async function dashboard(ctx: Ctx, today: string, db: Db = defaultDb): Promise<DashboardData> {
  const ws = toDateKey(weekStart(today));
  const days = weekDays(ws).map(toDateKey);
  const within = toDateKey(addDays(today, 7));
  const recentFrom = toDateKey(addDays(today, -6));

  const [doneRows, allIssues, penalties, missingWeekly, expiringRows, recentRows] = await Promise.all([
    db
      .select({ roundNo: roundingSessions.roundNo })
      .from(roundingSessions)
      .where(and(eq(roundingSessions.branchId, ctx.branchId), eq(roundingSessions.date, today), isNotNull(roundingSessions.completedAt)))
      .orderBy(asc(roundingSessions.roundNo)),
    listIssues(ctx, undefined, db),
    db
      .select({ memberId: checks.memberId, name: members.name, seatNo: seats.seatNo, points: sum(checks.points) })
      .from(checks)
      .innerJoin(members, eq(members.id, checks.memberId))
      .leftJoin(seats, eq(seats.id, members.seatId))
      .where(and(eq(checks.branchId, ctx.branchId), inArray(checks.date, days), eq(checks.grade, "p")))
      .groupBy(checks.memberId, members.name, seats.seatNo)
      .orderBy(desc(sql`sum(${checks.points})`), asc(seats.seatNo))
      .limit(5),
    missingWeeklyCount(ctx, ws, db),
    db
      .select({ memberId: members.id, name: members.name, seatNo: seats.seatNo, endDate: memberEnrollments.endDate })
      .from(memberEnrollments)
      .innerJoin(members, eq(members.id, memberEnrollments.memberId))
      .leftJoin(seats, eq(seats.id, members.seatId))
      .where(
        and(
          eq(members.branchId, ctx.branchId),
          eq(members.status, "enrolled"),
          lte(memberEnrollments.startDate, today),
          gte(memberEnrollments.endDate, today),
          lte(memberEnrollments.endDate, within),
        ),
      )
      .orderBy(asc(memberEnrollments.endDate), asc(seats.seatNo)),
    db
      .select({ date: roundingSessions.date, n: count() })
      .from(roundingSessions)
      .where(and(eq(roundingSessions.branchId, ctx.branchId), gte(roundingSessions.date, recentFrom), lte(roundingSessions.date, today), isNotNull(roundingSessions.completedAt)))
      .groupBy(roundingSessions.date),
  ]);
  const doneByDate = new Map(recentRows.map((r) => [r.date, Number(r.n)]));

  // 회원별로 가장 늦은 종료일 하나만
  const seen = new Map<string, (typeof expiringRows)[number]>();
  for (const r of expiringRows) {
    const prev = seen.get(r.memberId);
    if (!prev || prev.endDate < r.endDate) seen.set(r.memberId, r);
  }

  return {
    weekStart: ws,
    sessionsDone: doneRows.length,
    completedRounds: doneRows.map((r) => r.roundNo),
    roundsPerDay: ctx.settings.roundsPerDay,
    openIssues: allIssues.filter((i) => i.status !== "resolved").slice(0, 5),
    topPenalties: penalties.map((p) => ({ memberId: p.memberId, name: p.name, seatNo: p.seatNo, points: Number(p.points ?? 0) })),
    missingWeekly,
    expiring: [...seen.values()].map((r) => ({ ...r, daysLeft: daysLeft({ startDate: today, endDate: r.endDate }, today) })),
    recentRounds: Array.from({ length: 7 }, (_, k) => {
      const date = toDateKey(addDays(recentFrom, k));
      return { date, done: doneByDate.get(date) ?? 0 };
    }),
  };
}

export type BranchOverview = { branchId: string; branchName: string; enrolled: number; sessionsDone: number; roundsPerDay: number; openIssues: number; missingWeekly: number; weeklyPoints: number };

/** 본사 관리자용 전 지점 요약 */
export async function hqOverview(ctx: Ctx, today: string, db: Db = defaultDb): Promise<BranchOverview[]> {
  if (!ctx.isHqAdmin) throw new (await import("@/lib/errors")).ForbiddenError("본사 관리자만 볼 수 있습니다");
  const { branches } = await import("@/db/schema");
  const list = await db.select({ id: branches.id, name: branches.name, settings: branches.settings }).from(branches).where(eq(branches.active, true)).orderBy(asc(branches.code));
  const out: BranchOverview[] = [];
  for (const b of list) {
    const bctx: Ctx = { ...ctx, branchId: b.id, branchName: b.name, settings: b.settings };
    const [[cnt], d] = await Promise.all([
      db.select({ n: count() }).from(members).where(and(eq(members.branchId, b.id), eq(members.status, "enrolled"))),
      dashboard(bctx, today, db),
    ]);
    out.push({
      branchId: b.id,
      branchName: b.name,
      enrolled: Number(cnt?.n ?? 0),
      sessionsDone: d.sessionsDone,
      roundsPerDay: d.roundsPerDay,
      openIssues: d.openIssues.length,
      missingWeekly: d.missingWeekly,
      weeklyPoints: d.topPenalties.reduce((a, p) => a + p.points, 0),
    });
  }
  return out;
}
