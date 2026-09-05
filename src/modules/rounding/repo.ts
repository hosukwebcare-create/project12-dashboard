import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db as defaultDb, type Db, type Tx } from "@/db/client";
import { checks, issues, members, penaltyRules, roundingSessions, seats, users, type Grade } from "@/db/schema";
import { requireRole, type Ctx, type Role } from "@/lib/auth/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { pointsFor } from "@/lib/rules/penalty";
import { nextRoundNo } from "@/lib/rules/rounding";
import { createIssue } from "@/modules/issues/repo";
import { enqueueEvent, HIGH_PENALTY_THRESHOLD } from "@/modules/outbox/repo";

const CHECK_ROLES: Role[] = ["hq_admin", "branch_manager", "assistant"];

export type SessionRow = typeof roundingSessions.$inferSelect & { startedByName: string | null; checkedCount: number };
export type PenaltyRule = typeof penaltyRules.$inferSelect;

export type SheetRow = {
  memberId: string;
  seatNo: number | null;
  zone: string | null;
  name: string;
  fieldNote: string | null;
  focusCare: boolean;
  checkId: string | null;
  grade: Grade | null;
  points: number;
  penaltyRuleId: string | null;
  note: string | null;
  isIssue: boolean;
  arrivalTime: string | null;
  called: boolean | null;
  /** 같은 날 이전 회차(일별 항목이면 당일 전체)의 벌점 규칙 이름. 연속 졸음 추천에 쓴다 */
  priorPenalties: string[];
};

export type CheckInput = {
  memberId: string;
  date: string;
  itemKey: string;
  roundNo: number;
  sessionId?: string | null;
  grade: Grade;
  penaltyRuleId?: string | null;
  note?: string | null;
  isIssue?: boolean;
  arrivalTime?: string | null;
  called?: boolean | null;
};

/** 지점 오버라이드가 있으면 그것만, 없으면 본사 기본 규칙 */
export async function penaltyRulesFor(ctx: Pick<Ctx, "branchId">, db: Db | Tx = defaultDb): Promise<PenaltyRule[]> {
  const rows = await db
    .select()
    .from(penaltyRules)
    .where(and(eq(penaltyRules.active, true), or(eq(penaltyRules.branchId, ctx.branchId), isNull(penaltyRules.branchId))))
    .orderBy(asc(penaltyRules.sort), asc(penaltyRules.name));
  const branchRules = rows.filter((r) => r.branchId === ctx.branchId);
  return branchRules.length ? branchRules : rows.filter((r) => r.branchId === null);
}

export async function todaySessions(ctx: Ctx, date: string, db: Db = defaultDb): Promise<SessionRow[]> {
  const rows = await db
    .select({ s: roundingSessions, startedByName: users.name })
    .from(roundingSessions)
    .leftJoin(users, eq(users.id, roundingSessions.startedBy))
    .where(and(eq(roundingSessions.branchId, ctx.branchId), eq(roundingSessions.date, date)))
    .orderBy(asc(roundingSessions.roundNo));
  if (rows.length === 0) return [];
  const counts = await db
    .select({ sessionId: checks.sessionId, n: count() })
    .from(checks)
    .where(inArray(checks.sessionId, rows.map((r) => r.s.id)))
    .groupBy(checks.sessionId);
  const byId = new Map(counts.map((c) => [c.sessionId, Number(c.n)]));
  return rows.map((r) => ({ ...r.s, startedByName: r.startedByName, checkedCount: byId.get(r.s.id) ?? 0 }));
}

export async function startSession(ctx: Ctx, date: string, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...CHECK_ROLES);
  const existing = await db
    .select({ roundNo: roundingSessions.roundNo })
    .from(roundingSessions)
    .where(and(eq(roundingSessions.branchId, ctx.branchId), eq(roundingSessions.date, date)));
  const next = nextRoundNo(existing.map((e) => e.roundNo), ctx.settings.roundsPerDay);
  if (next === null) throw new ValidationError("오늘 회차를 모두 진행했습니다");
  const [row] = await db
    .insert(roundingSessions)
    .values({ branchId: ctx.branchId, date, roundNo: next, startedBy: ctx.userId })
    .returning({ id: roundingSessions.id });
  return row.id;
}

async function findSession(ctx: Ctx, sessionId: string, db: Db | Tx) {
  const [s] = await db
    .select()
    .from(roundingSessions)
    .where(and(eq(roundingSessions.id, sessionId), eq(roundingSessions.branchId, ctx.branchId)))
    .limit(1);
  if (!s) throw new NotFoundError("회차를 찾을 수 없습니다");
  return s;
}

/** 등록 회원 × 특정 (date, itemKey, roundNo) 체크 상태 */
export async function sheetRows(ctx: Ctx, date: string, itemKey: string, roundNo: number, db: Db | Tx = defaultDb): Promise<SheetRow[]> {
  const rows = await db
    .select({
      memberId: members.id,
      seatNo: seats.seatNo,
      zone: seats.zone,
      name: members.name,
      fieldNote: members.fieldNote,
      focusCare: members.focusCare,
      checkId: checks.id,
      grade: checks.grade,
      points: checks.points,
      penaltyRuleId: checks.penaltyRuleId,
      note: checks.note,
      isIssue: checks.isIssue,
      arrivalTime: checks.arrivalTime,
      called: checks.called,
    })
    .from(members)
    .leftJoin(seats, eq(seats.id, members.seatId))
    .leftJoin(
      checks,
      and(eq(checks.memberId, members.id), eq(checks.date, date), eq(checks.itemKey, itemKey), eq(checks.roundNo, roundNo)),
    )
    .where(and(eq(members.branchId, ctx.branchId), eq(members.status, "enrolled")))
    .orderBy(sql`${seats.seatNo} asc nulls last`, asc(members.name));
  const priorConds = [eq(checks.branchId, ctx.branchId), eq(checks.date, date), eq(checks.grade, "p")];
  if (itemKey === "round") priorConds.push(sql`${checks.itemKey} = 'round' and ${checks.roundNo} < ${roundNo}`);
  else priorConds.push(sql`not (${checks.itemKey} = ${itemKey} and ${checks.roundNo} = ${roundNo})`);
  const prior = await db
    .select({ memberId: checks.memberId, roundNo: checks.roundNo, name: penaltyRules.name })
    .from(checks)
    .leftJoin(penaltyRules, eq(penaltyRules.id, checks.penaltyRuleId))
    .where(and(...priorConds))
    .orderBy(asc(checks.roundNo));
  const priorByMember = new Map<string, string[]>();
  for (const p of prior) priorByMember.set(p.memberId, [...(priorByMember.get(p.memberId) ?? []), p.name ?? "벌점"]);
  return rows.map((r) => ({ ...r, points: r.points ?? 0, isIssue: r.isIssue ?? false, priorPenalties: priorByMember.get(r.memberId) ?? [] }));
}

export async function sessionSheet(ctx: Ctx, sessionId: string, db: Db = defaultDb) {
  const session = await findSession(ctx, sessionId, db);
  const [rows, rules] = await Promise.all([sheetRows(ctx, session.date, "round", session.roundNo, db), penaltyRulesFor(ctx, db)]);
  return { session, rows, rules };
}

export async function upsertCheck(ctx: Ctx, input: CheckInput, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...CHECK_ROLES);
  await db.transaction(async (tx) => {
    const [m] = await tx
      .select({ id: members.id, name: members.name, seatNo: seats.seatNo })
      .from(members)
      .leftJoin(seats, eq(seats.id, members.seatId))
      .where(and(eq(members.id, input.memberId), eq(members.branchId, ctx.branchId)))
      .limit(1);
    if (!m) throw new NotFoundError("회원을 찾을 수 없습니다");
    if (input.sessionId) await findSession(ctx, input.sessionId, tx);

    let rule: PenaltyRule | null = null;
    if (input.grade === "p" && input.penaltyRuleId) {
      const [r] = await tx
        .select()
        .from(penaltyRules)
        .where(and(eq(penaltyRules.id, input.penaltyRuleId), or(eq(penaltyRules.branchId, ctx.branchId), isNull(penaltyRules.branchId))))
        .limit(1);
      if (!r) throw new NotFoundError("벌점 규칙을 찾을 수 없습니다");
      rule = r;
    }
    const values = {
      branchId: ctx.branchId,
      memberId: input.memberId,
      seatNoSnapshot: m.seatNo,
      date: input.date,
      itemKey: input.itemKey,
      roundNo: input.roundNo,
      sessionId: input.sessionId ?? null,
      grade: input.grade,
      points: pointsFor(input.grade, rule?.points ?? null),
      penaltyRuleId: input.grade === "p" ? (rule?.id ?? null) : null,
      note: input.note ?? null,
      isIssue: input.isIssue ?? false,
      arrivalTime: input.arrivalTime ?? null,
      called: input.called ?? null,
      createdBy: ctx.userId,
    };
    const [row] = await tx
      .insert(checks)
      .values(values)
      .onConflictDoUpdate({
        target: [checks.memberId, checks.date, checks.itemKey, checks.roundNo],
        set: { ...values, updatedAt: new Date() },
      })
      .returning({ id: checks.id });

    if (values.grade === "p" && values.points >= HIGH_PENALTY_THRESHOLD) {
      const where = input.itemKey === "round" ? `R${input.roundNo}` : input.itemKey;
      await enqueueEvent(tx, ctx.branchId, "penalty.high", { memberId: m.id, member: m.name, seatNo: m.seatNo, points: values.points, rule: rule?.name ?? null, date: input.date, where }, `[고벌점] ${m.seatNo ?? "-"}번 ${m.name} · ${rule?.name ?? "벌점"} ${values.points}점 (${input.date} ${where})`);
    }
    if (values.isIssue) {
      const [exists] = await tx.select({ id: issues.id }).from(issues).where(eq(issues.checkId, row.id)).limit(1);
      if (!exists) {
        const where = input.itemKey === "round" ? `R${input.roundNo}` : input.itemKey;
        await createIssue(
          ctx,
          {
            memberId: m.id,
            title: `${m.name} · ${rule?.name ?? "이슈"} (${input.date} ${where})`,
            body: input.note ?? null,
            severity: rule && rule.points >= 5 ? "high" : "normal",
            source: "rounding",
            checkId: row.id,
          },
          tx,
        );
      }
    }
  });
}

export type SessionSummary = { penalties: number; points: number; issues: number; absent: number; total: number };

export async function completeSession(ctx: Ctx, sessionId: string, db: Db = defaultDb): Promise<SessionSummary> {
  requireRole(ctx, ...CHECK_ROLES);
  return db.transaction(async (tx) => {
    const session = await findSession(ctx, sessionId, tx);
    const rows = await sheetRows(ctx, session.date, "round", session.roundNo, tx);
    const missing = rows.filter((r) => !r.checkId);
    if (missing.length) {
      await tx.insert(checks).values(
        missing.map((r) => ({
          branchId: ctx.branchId,
          memberId: r.memberId,
          seatNoSnapshot: r.seatNo,
          date: session.date,
          itemKey: "round",
          roundNo: session.roundNo,
          sessionId,
          grade: "a" as const,
          points: 0,
          createdBy: ctx.userId,
        })),
      );
    }
    await tx.update(roundingSessions).set({ completedAt: new Date() }).where(eq(roundingSessions.id, sessionId));
    const final = await sheetRows(ctx, session.date, "round", session.roundNo, tx);
    return {
      penalties: final.filter((r) => r.grade === "p").length,
      points: final.reduce((a, r) => a + (r.grade === "p" ? r.points : 0), 0),
      issues: final.filter((r) => r.isIssue).length,
      absent: final.filter((r) => r.grade === "na").length,
      total: final.length,
    };
  });
}

export type DayHistory = {
  sessions: SessionRow[];
  rows: { memberId: string; seatNo: number | null; name: string; byRound: Record<number, { grade: Grade; points: number; isIssue: boolean }> }[];
};

export async function dayHistory(ctx: Ctx, date: string, db: Db = defaultDb): Promise<DayHistory> {
  const sessions = await todaySessions(ctx, date, db);
  const memberRows = await db
    .select({ memberId: members.id, seatNo: seats.seatNo, name: members.name })
    .from(members)
    .leftJoin(seats, eq(seats.id, members.seatId))
    .where(and(eq(members.branchId, ctx.branchId), eq(members.status, "enrolled")))
    .orderBy(sql`${seats.seatNo} asc nulls last`, asc(members.name));
  const checkRows = await db
    .select({ memberId: checks.memberId, roundNo: checks.roundNo, grade: checks.grade, points: checks.points, isIssue: checks.isIssue })
    .from(checks)
    .where(and(eq(checks.branchId, ctx.branchId), eq(checks.date, date), eq(checks.itemKey, "round")));
  const byMember = new Map<string, DayHistory["rows"][number]["byRound"]>();
  for (const c of checkRows) {
    const m = byMember.get(c.memberId) ?? {};
    m[c.roundNo] = { grade: c.grade, points: c.points, isIssue: c.isIssue };
    byMember.set(c.memberId, m);
  }
  return { sessions, rows: memberRows.map((r) => ({ ...r, byRound: byMember.get(r.memberId) ?? {} })) };
}

export async function recentSessionDates(ctx: Ctx, limit = 14, db: Db = defaultDb): Promise<string[]> {
  const rows = await db
    .selectDistinct({ date: roundingSessions.date })
    .from(roundingSessions)
    .where(eq(roundingSessions.branchId, ctx.branchId))
    .orderBy(desc(roundingSessions.date))
    .limit(limit);
  return rows.map((r) => r.date);
}

export type MemberWeek = {
  weekStart: string;
  days: string[];
  items: { key: string; label: string; kind: "daily" | "round" }[];
  roundsPerDay: number;
  /** `${date}|${itemKey}|${roundNo}` */
  cells: Record<string, { grade: Grade; points: number; note: string | null; ruleName: string | null }>;
  totalPoints: number;
};

/** 회원 한 명의 한 주 체크 현황 (회원 상세 탭용) */
export async function memberWeek(ctx: Ctx, memberId: string, weekStartInput: string, db: Db = defaultDb): Promise<MemberWeek> {
  const [m] = await db.select({ id: members.id }).from(members).where(and(eq(members.id, memberId), eq(members.branchId, ctx.branchId))).limit(1);
  if (!m) throw new NotFoundError("회원을 찾을 수 없습니다");
  const { boardItemsFor } = await import("@/modules/settings/repo");
  const { weekDays, weekStart, toDateKey } = await import("@/lib/rules/week");
  const ws = toDateKey(weekStart(weekStartInput));
  const days = weekDays(ws).map(toDateKey);
  const [items, rows] = await Promise.all([
    boardItemsFor(ctx, db),
    db
      .select({ c: checks, ruleName: penaltyRules.name })
      .from(checks)
      .leftJoin(penaltyRules, eq(penaltyRules.id, checks.penaltyRuleId))
      .where(and(eq(checks.memberId, memberId), inArray(checks.date, days))),
  ]);
  const cells: MemberWeek["cells"] = {};
  let totalPoints = 0;
  for (const { c, ruleName } of rows) {
    cells[`${c.date}|${c.itemKey}|${c.roundNo}`] = { grade: c.grade, points: c.points, note: c.note, ruleName };
    if (c.grade === "p") totalPoints += c.points;
  }
  return { weekStart: ws, days, items: items.map((i) => ({ key: i.key, label: i.label, kind: i.kind })), roundsPerDay: ctx.settings.roundsPerDay, cells, totalPoints };
}
