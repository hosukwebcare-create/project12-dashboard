import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db as defaultDb, type Db, type Tx } from "@/db/client";
import { checks, issues, members, penaltyRules, roundingSessions, seats, users, type Grade } from "@/db/schema";
import { requireRole, type Ctx, type Role } from "@/lib/auth/ctx";
import { writeAudit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { pointsFor } from "@/lib/rules/penalty";
import { ATTENDANCE_KEY, AUTO_ATTENDANCE_NOTE, canFillRest, carryForwardGrade, cellKey, dayColumns, deriveAttendance, isAutoAttendance, nextRoundNo, type DayColumn } from "@/lib/rules/rounding";
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

/** 회차 id 로 그 회차의 날짜·번호. 예전 회차 주소를 하루 표로 넘길 때 쓴다 */
export async function sessionById(ctx: Ctx, sessionId: string, db: Db = defaultDb) {
  return findSession(ctx, sessionId, db);
}

/**
 * 그 날짜·회차의 세션을 찾고, 없으면 만든다. 하루 표에서는 '회차 시작'을 따로 누르지 않는다 —
 * 그 회차에 처음 적는 순간 시작한 것으로 본다(누가 시작했는지는 남긴다).
 */
async function ensureSession(ctx: Ctx, tx: Db | Tx, date: string, roundNo: number) {
  if (!Number.isInteger(roundNo) || roundNo < 1 || roundNo > ctx.settings.roundsPerDay) throw new ValidationError(`회차는 1~${ctx.settings.roundsPerDay} 사이여야 합니다`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("날짜 형식 오류");
  const where = and(eq(roundingSessions.branchId, ctx.branchId), eq(roundingSessions.date, date), eq(roundingSessions.roundNo, roundNo));
  const [existing] = await tx.select().from(roundingSessions).where(where).limit(1);
  if (existing) return existing;
  const [row] = await tx.insert(roundingSessions).values({ branchId: ctx.branchId, date, roundNo, startedBy: ctx.userId }).onConflictDoNothing().returning();
  if (row) return row;
  const [again] = await tx.select().from(roundingSessions).where(where).limit(1);
  return again;
}

/** 하루 표 한 칸의 값. 출석 칸은 auto 로 라운딩에서 채운 것인지 표시한다 */
export type DayCell = { grade: Grade; points: number; penaltyRuleId: string | null; note: string | null; isIssue: boolean; auto: boolean };
/** 바뀐 칸들. null 은 비워졌다는 뜻 */
export type CellPatch = Record<string, DayCell | null>;

function toCell(c: { itemKey: string; grade: Grade; points: number; penaltyRuleId: string | null; note: string | null; isIssue: boolean }): DayCell {
  return { grade: c.grade, points: c.points, penaltyRuleId: c.penaltyRuleId, note: c.note, isIssue: c.isIssue, auto: c.itemKey === ATTENDANCE_KEY && isAutoAttendance(c.note) };
}

/**
 * 출석을 그날 라운딩 모습에 맞춘다. 사람이 적은 출석(이관한 시트 값 포함)은 건드리지 않고,
 * 라운딩에서 채운 출석만 새로 쓰거나 고치거나 지운다. 바뀐 출석 칸을 돌려준다.
 */
async function syncAttendance(ctx: Ctx, tx: Db | Tx, date: string, memberIds: string[]): Promise<CellPatch> {
  const patch: CellPatch = {};
  if (!memberIds.length) return patch;
  const rows = await tx
    .select({ id: checks.id, memberId: checks.memberId, itemKey: checks.itemKey, grade: checks.grade, note: checks.note, seatNo: checks.seatNoSnapshot })
    .from(checks)
    .where(and(eq(checks.branchId, ctx.branchId), eq(checks.date, date), inArray(checks.memberId, memberIds), inArray(checks.itemKey, ["round", ATTENDANCE_KEY])));
  const inserts: (typeof checks.$inferInsert)[] = [];
  for (const memberId of memberIds) {
    const mine = rows.filter((r) => r.memberId === memberId);
    const att = mine.find((r) => r.itemKey === ATTENDANCE_KEY);
    if (att && !isAutoAttendance(att.note)) continue;
    const rounds = mine.filter((r) => r.itemKey === "round");
    const derived = deriveAttendance(rounds.map((r) => r.grade));
    const key = cellKey(memberId, ATTENDANCE_KEY, 0);
    if (!derived) {
      if (att) {
        await tx.delete(checks).where(eq(checks.id, att.id));
        patch[key] = null;
      }
      continue;
    }
    const cell: DayCell = { grade: derived, points: 0, penaltyRuleId: null, note: AUTO_ATTENDANCE_NOTE, isIssue: false, auto: true };
    if (att) {
      if (att.grade !== derived || att.note !== AUTO_ATTENDANCE_NOTE) await tx.update(checks).set({ grade: derived, note: AUTO_ATTENDANCE_NOTE, updatedAt: new Date() }).where(eq(checks.id, att.id));
      patch[key] = cell;
      continue;
    }
    inserts.push({ branchId: ctx.branchId, memberId, seatNoSnapshot: rounds[0]?.seatNo ?? null, date, itemKey: ATTENDANCE_KEY, roundNo: 0, grade: derived, points: 0, note: AUTO_ATTENDANCE_NOTE, createdBy: ctx.userId });
    patch[key] = cell;
  }
  if (inserts.length) await tx.insert(checks).values(inserts).onConflictDoNothing({ target: [checks.memberId, checks.date, checks.itemKey, checks.roundNo] });
  return patch;
}

export async function upsertCheck(ctx: Ctx, input: CheckInput, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...CHECK_ROLES);
  await db.transaction((tx) => upsertCheckTx(ctx, tx, input));
}

/** 하루 표에서 칸 하나를 적는다. 적은 칸과, 그 때문에 바뀐 출석 칸을 돌려준다 */
export async function saveCell(ctx: Ctx, input: CheckInput, db: Db = defaultDb): Promise<CellPatch> {
  requireRole(ctx, ...CHECK_ROLES);
  return db.transaction((tx) => upsertCheckTx(ctx, tx, input));
}

async function upsertCheckTx(ctx: Ctx, tx: Tx, input: CheckInput): Promise<CellPatch> {
  {
    const [m] = await tx
      .select({ id: members.id, name: members.name, seatNo: seats.seatNo })
      .from(members)
      .leftJoin(seats, eq(seats.id, members.seatId))
      .where(and(eq(members.id, input.memberId), eq(members.branchId, ctx.branchId)))
      .limit(1);
    if (!m) throw new NotFoundError("회원을 찾을 수 없습니다");
    // 라운딩은 회차에 묶인다. 회차 id 를 모르면(하루 표) 그 회차를 찾거나 새로 연다
    let sessionId = input.sessionId ?? null;
    if (input.itemKey === "round") sessionId = (sessionId ? await findSession(ctx, sessionId, tx) : await ensureSession(ctx, tx, input.date, input.roundNo)).id;
    else if (sessionId) await findSession(ctx, sessionId, tx);

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
      sessionId,
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

    // 출석은 적지 않는다. 라운딩을 적을 때마다 그날 모습으로 다시 맞춘다
    const patch: CellPatch = { [cellKey(m.id, input.itemKey, input.roundNo)]: toCell({ ...values, penaltyRuleId: values.penaltyRuleId }) };
    if (input.itemKey === "round") Object.assign(patch, await syncAttendance(ctx, tx, input.date, [m.id]));

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
    return patch;
  }
}

/**
 * 칸을 비운다. 잘못 누른 것을 되돌리는 지우개. 출석은 라운딩에서 채우므로 지우지 않는다.
 * 그 칸으로 만든 이슈는 이슈함에 남기고 연결만 끊는다.
 */
export async function clearCheck(ctx: Ctx, input: { memberId: string; date: string; itemKey: string; roundNo: number }, db: Db = defaultDb): Promise<CellPatch> {
  requireRole(ctx, ...CHECK_ROLES);
  if (input.itemKey === ATTENDANCE_KEY) throw new ValidationError("출석은 라운딩에서 자동으로 채워집니다");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(checks)
      .where(and(eq(checks.branchId, ctx.branchId), eq(checks.memberId, input.memberId), eq(checks.date, input.date), eq(checks.itemKey, input.itemKey), eq(checks.roundNo, input.roundNo)))
      .limit(1);
    const patch: CellPatch = { [cellKey(input.memberId, input.itemKey, input.roundNo)]: null };
    if (!row) return patch;
    await tx.update(issues).set({ checkId: null }).where(eq(issues.checkId, row.id));
    await tx.delete(checks).where(eq(checks.id, row.id));
    await writeAudit(tx, ctx, "check", row.id, "delete", { grade: row.grade, points: row.points, penaltyRuleId: row.penaltyRuleId, note: row.note, itemKey: row.itemKey, roundNo: row.roundNo, date: row.date }, null);
    if (input.itemKey === "round") Object.assign(patch, await syncAttendance(ctx, tx, input.date, [input.memberId]));
    return patch;
  });
}

/**
 * 직전 회차 값을 이 회차의 빈 칸에 가져온다. 시트에서 윗줄을 끌어내리던 일이다 —
 * 한 회차 값의 88%가 직전 회차와 같아서, 가져온 뒤 바뀐 학생만 고치면 된다.
 * 이미 적은 칸은 건드리지 않고, 벌점은 옮기지 않는다(자리에 있었으니 a).
 */
export async function copyPreviousRound(ctx: Ctx, date: string, roundNo: number, db: Db = defaultDb): Promise<CellPatch> {
  requireRole(ctx, ...CHECK_ROLES);
  if (roundNo < 2) throw new ValidationError("첫 회차는 가져올 앞 회차가 없습니다");
  return db.transaction(async (tx) => {
    const session = await ensureSession(ctx, tx, date, roundNo);
    const [current, prev] = await Promise.all([sheetRows(ctx, date, "round", roundNo, tx), sheetRows(ctx, date, "round", roundNo - 1, tx)]);
    const prevBy = new Map(prev.filter((r) => r.grade).map((r) => [r.memberId, r.grade as Grade]));
    const targets = current.filter((r) => !r.checkId && prevBy.has(r.memberId));
    const patch: CellPatch = {};
    if (!targets.length) return patch;
    const values = targets.map((r) => ({ branchId: ctx.branchId, memberId: r.memberId, seatNoSnapshot: r.seatNo, date, itemKey: "round", roundNo, sessionId: session.id, grade: carryForwardGrade(prevBy.get(r.memberId)!), points: 0, createdBy: ctx.userId }));
    await tx.insert(checks).values(values).onConflictDoNothing({ target: [checks.memberId, checks.date, checks.itemKey, checks.roundNo] });
    for (const v of values) patch[cellKey(v.memberId, "round", roundNo)] = { grade: v.grade, points: 0, penaltyRuleId: null, note: null, isIssue: false, auto: false };
    Object.assign(patch, await syncAttendance(ctx, tx, date, values.map((v) => v.memberId)));
    await writeAudit(tx, ctx, "check", session.id, "create", null, { bulk: "copy_previous_round", date, roundNo, count: values.length });
    return patch;
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
  return db.transaction(async (tx) => (await completeSessionTx(ctx, tx, await findSession(ctx, sessionId, tx))).summary);
}

/** 하루 표에서 회차를 완료한다: 빈 칸을 a 로 채우고 완료 표시. 채운 칸과 바뀐 출석을 함께 돌려준다 */
export async function completeRound(ctx: Ctx, date: string, roundNo: number, db: Db = defaultDb): Promise<{ summary: SessionSummary; patch: CellPatch }> {
  requireRole(ctx, ...CHECK_ROLES);
  return db.transaction(async (tx) => completeSessionTx(ctx, tx, await ensureSession(ctx, tx, date, roundNo)));
}

async function completeSessionTx(ctx: Ctx, tx: Tx, session: typeof roundingSessions.$inferSelect): Promise<{ summary: SessionSummary; patch: CellPatch }> {
  const rows = await sheetRows(ctx, session.date, "round", session.roundNo, tx);
  const missing = rows.filter((r) => !r.checkId);
  const patch: CellPatch = {};
  if (missing.length) {
    await tx.insert(checks).values(
      missing.map((r) => ({
        branchId: ctx.branchId,
        memberId: r.memberId,
        seatNoSnapshot: r.seatNo,
        date: session.date,
        itemKey: "round",
        roundNo: session.roundNo,
        sessionId: session.id,
        grade: "a" as const,
        points: 0,
        createdBy: ctx.userId,
      })),
    );
    for (const r of missing) patch[cellKey(r.memberId, "round", session.roundNo)] = { grade: "a", points: 0, penaltyRuleId: null, note: null, isIssue: false, auto: false };
    Object.assign(patch, await syncAttendance(ctx, tx, session.date, missing.map((r) => r.memberId)));
  }
  await tx.update(roundingSessions).set({ completedAt: new Date() }).where(eq(roundingSessions.id, session.id));
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
    { sessionId: session.id, date: session.date, roundNo: session.roundNo, ...summary, completedBy: ctx.userName },
    `[회차 완료] ${session.date} R${session.roundNo} · ${summary.total}명 · 벌점 ${summary.penalties}건 ${summary.points}점 · 이슈 ${summary.issues}건 · 부재 ${summary.absent}명 (입력: ${ctx.userName})`,
  );
  return { summary, patch };
}

export type DayMember = { memberId: string; seatNo: number | null; zone: string | null; name: string; fieldNote: string | null; focusCare: boolean };
export type DaySession = { roundNo: number; startedByName: string | null; completedAt: string | null };
export type DaySheet = {
  date: string;
  columns: DayColumn[];
  members: DayMember[];
  /** cellKey(memberId, itemKey, roundNo) → 값 */
  cells: Record<string, DayCell>;
  rules: { id: string; name: string; points: number }[];
  sessions: DaySession[];
};

/**
 * 하루 표: 등록 학생 × (출석·일별 항목·R1…Rn). 시트의 하루 블록과 같은 내용을 한 화면에 담는다.
 * 라운딩과 일별 체크를 따로 돌지 않고, 태블릿에서는 누르기만, PC 에서는 메모까지 같은 표에서 적는다.
 */
export async function daySheet(ctx: Ctx, date: string, db: Db = defaultDb): Promise<DaySheet> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("날짜 형식 오류");
  const [items, rules, memberRows, checkRows, sessions] = await Promise.all([
    boardItemsFor(ctx, db),
    penaltyRulesFor(ctx, db),
    db
      .select({ memberId: members.id, seatNo: seats.seatNo, zone: seats.zone, name: members.name, fieldNote: members.fieldNote, focusCare: members.focusCare })
      .from(members)
      .leftJoin(seats, eq(seats.id, members.seatId))
      .where(and(eq(members.branchId, ctx.branchId), eq(members.status, "enrolled")))
      .orderBy(sql`${seats.seatNo} asc nulls last`, asc(members.name)),
    db
      .select({ memberId: checks.memberId, itemKey: checks.itemKey, roundNo: checks.roundNo, grade: checks.grade, points: checks.points, penaltyRuleId: checks.penaltyRuleId, note: checks.note, isIssue: checks.isIssue })
      .from(checks)
      .where(and(eq(checks.branchId, ctx.branchId), eq(checks.date, date))),
    todaySessions(ctx, date, db),
  ]);
  const cells: Record<string, DayCell> = {};
  for (const c of checkRows) cells[cellKey(c.memberId, c.itemKey, c.roundNo)] = toCell(c);
  return {
    date,
    columns: dayColumns(items, ctx.settings.roundsPerDay, ctx.settings.roundSchedule ?? []),
    members: memberRows,
    cells,
    rules: rules.map((r) => ({ id: r.id, name: r.name, points: r.points })),
    sessions: sessions.map((s) => ({ roundNo: s.roundNo, startedByName: s.startedByName, completedAt: s.completedAt?.toISOString() ?? null })),
  };
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
