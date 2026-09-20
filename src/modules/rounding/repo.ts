import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db as defaultDb, type Db, type Tx } from "@/db/client";
import { checks, issues, members, penaltyRules, roundingSessions, seats, users, type Grade } from "@/db/schema";
import { requireRole, type Ctx, type Role } from "@/lib/auth/ctx";
import { writeAudit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { pointsFor } from "@/lib/rules/penalty";
import { canFillRest, impliesPresent, nextRoundNo, roundCompanionKeys } from "@/lib/rules/rounding";
import { createIssue } from "@/modules/issues/repo";
import { enqueueEvent, HIGH_PENALTY_THRESHOLD } from "@/modules/outbox/repo";
import { boardItemsFor } from "@/modules/settings/repo";

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

/** 라운딩과 같은 화면에서 함께 기록하는 일별 항목 하나 */
export type Companion = { key: string; label: string; rows: SheetRow[] };

/** 이 지점이 라운딩과 함께 기록하기로 한 일별 항목과, 그날의 체크 상태 */
export async function roundCompanions(ctx: Ctx, date: string, db: Db = defaultDb): Promise<Companion[]> {
  const daily = (await boardItemsFor(ctx, db)).filter((i) => i.kind === "daily");
  const keys = roundCompanionKeys(ctx.settings.roundCompanions, daily.map((i) => i.key));
  return Promise.all(keys.map(async (key) => ({ key, label: daily.find((i) => i.key === key)!.label, rows: await sheetRows(ctx, date, key, 0, db) })));
}

export async function sessionSheet(ctx: Ctx, sessionId: string, db: Db = defaultDb) {
  const session = await findSession(ctx, sessionId, db);
  const [rows, rules, companions] = await Promise.all([sheetRows(ctx, session.date, "round", session.roundNo, db), penaltyRulesFor(ctx, db), roundCompanions(ctx, session.date, db)]);
  return { session, rows, rules, companions };
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
    const [prev] = await tx
      .select({ id: checks.id, grade: checks.grade, points: checks.points, penaltyRuleId: checks.penaltyRuleId, note: checks.note })
      .from(checks)
      .where(and(eq(checks.memberId, input.memberId), eq(checks.date, input.date), eq(checks.itemKey, input.itemKey), eq(checks.roundNo, input.roundNo)))
      .limit(1);
    const [row] = await tx
      .insert(checks)
      .values(values)
      .onConflictDoUpdate({
        target: [checks.memberId, checks.date, checks.itemKey, checks.roundNo],
        set: { ...values, updatedAt: new Date() },
      })
      .returning({ id: checks.id });
    // 저장된 체크의 등급·점수·메모가 바뀌면 이전 값을 감사 로그에 남긴다
    if (prev && (prev.grade !== values.grade || prev.points !== values.points || prev.penaltyRuleId !== values.penaltyRuleId || (prev.note ?? null) !== values.note)) {
      await writeAudit(tx, ctx, "check", row.id, "update", { grade: prev.grade, points: prev.points, penaltyRuleId: prev.penaltyRuleId, note: prev.note }, { grade: values.grade, points: values.points, penaltyRuleId: values.penaltyRuleId, note: values.note });
    }

    // 라운딩에서 자리에 있던 학생은 출석한 것이다. 지점이 켜 둔 경우에만, 아직 출석을 안 적은 학생만 채운다.
    // 이미 적힌 출석(지각 시각·CALL 포함)은 건드리지 않는다.
    if (input.itemKey === "round" && ctx.settings.autoAttendance && impliesPresent(values.grade)) {
      await tx
        .insert(checks)
        .values({ branchId: ctx.branchId, memberId: m.id, seatNoSnapshot: m.seatNo, date: input.date, itemKey: "attendance", roundNo: 0, grade: "a", points: 0, note: `R${input.roundNo} 라운딩에서 확인`, createdBy: ctx.userId })
        .onConflictDoNothing({ target: [checks.memberId, checks.date, checks.itemKey, checks.roundNo] });
    }

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

/**
 * 일별 항목에서 아직 표시하지 않은 등록 회원을 모두 a 로 채운다. 예외만 먼저 적고 나머지를 한 번에 끝내기 위한 것.
 * 출석과 라운딩은 받지 않는다(출석은 canFillRest 설명 참고, 라운딩은 회차 완료가 같은 일을 한다).
 */
export async function fillRemaining(ctx: Ctx, date: string, itemKey: string, db: Db = defaultDb): Promise<number> {
  requireRole(ctx, ...CHECK_ROLES);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("날짜 형식 오류");
  if (!canFillRest(itemKey)) throw new ValidationError("이 항목은 한꺼번에 채울 수 없습니다");
  return db.transaction(async (tx) => {
    const item = (await boardItemsFor(ctx, tx)).find((i) => i.kind === "daily" && i.key === itemKey);
    if (!item) throw new NotFoundError("항목을 찾을 수 없습니다");
    const missing = (await sheetRows(ctx, date, itemKey, 0, tx)).filter((r) => !r.checkId);
    if (!missing.length) return 0;
    await tx
      .insert(checks)
      .values(missing.map((r) => ({ branchId: ctx.branchId, memberId: r.memberId, seatNoSnapshot: r.seatNo, date, itemKey, roundNo: 0, grade: "a" as const, points: 0, createdBy: ctx.userId })))
      .onConflictDoNothing({ target: [checks.memberId, checks.date, checks.itemKey, checks.roundNo] });
    await writeAudit(tx, ctx, "check", ctx.branchId, "create", null, { bulk: "fill_rest", date, itemKey, count: missing.length });
    return missing.length;
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
    const summary: SessionSummary = {
      penalties: final.filter((r) => r.grade === "p").length,
      points: final.reduce((a, r) => a + (r.grade === "p" ? r.points : 0), 0),
      issues: final.filter((r) => r.isIssue).length,
      absent: final.filter((r) => r.grade === "na").length,
      total: final.length,
    };
    // 메신저 웹훅 구독 항목(라운딩 회차 완료)에 해당하는 이벤트. 구독한 채널이 없으면 enqueueEvent 가 아무것도 쌓지 않는다.
    await enqueueEvent(
      tx,
      ctx.branchId,
      "session.completed",
      { sessionId, date: session.date, roundNo: session.roundNo, ...summary, completedBy: ctx.userName },
      `[회차 완료] ${session.date} R${session.roundNo} · ${summary.total}명 · 벌점 ${summary.penalties}건 ${summary.points}점 · 이슈 ${summary.issues}건 · 부재 ${summary.absent}명 (입력: ${ctx.userName})`,
    );
    return summary;
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
