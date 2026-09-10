import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { memberships, shiftSlots, staffProfiles, users, workLogs } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { MANAGER_ROLES, requireRole, type Ctx } from "@/lib/auth/ctx";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { monthDates } from "@/lib/rules/meals";
import { addDays, toDateKey, weekStart } from "@/lib/rules/week";
import { computeHoursX100, DEFAULT_TARGET_HOURS_X100, elapsedToHoursX100 } from "@/lib/rules/worklog";

export type ShiftSlot = typeof shiftSlots.$inferSelect;
export type ShiftSlotInput = { id?: string; key: string; label: string; startTime: string; endTime: string; hoursX100: number; weekend: boolean; sort: number; active: boolean };
export const EMPLOYMENT_TYPES = ["주간조교", "야간조교", "컨설팅", "원장", "기타"] as const;

export async function listShiftSlots(ctx: Pick<Ctx, "branchId">, db: Db = defaultDb, includeInactive = false): Promise<ShiftSlot[]> {
  const conds = [eq(shiftSlots.branchId, ctx.branchId)];
  if (!includeInactive) conds.push(eq(shiftSlots.active, true));
  return db.select().from(shiftSlots).where(and(...conds)).orderBy(asc(shiftSlots.sort), asc(shiftSlots.key));
}

export async function upsertShiftSlot(ctx: Ctx, input: ShiftSlotInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...MANAGER_ROLES);
  const key = input.key.trim().toLowerCase();
  if (!/^[a-z0-9_]{1,20}$/.test(key)) throw new ValidationError("타임 키는 영문·숫자 1~20자");
  if (!input.label.trim()) throw new ValidationError("타임 이름을 입력하세요");
  if (!/^\d{2}:\d{2}$/.test(input.startTime) || !/^\d{2}:\d{2}$/.test(input.endTime)) throw new ValidationError("시각은 HH:mm 형식");
  if (!Number.isInteger(input.hoursX100) || input.hoursX100 < 0) throw new ValidationError("인정 시간이 올바르지 않습니다");
  const conds = [eq(shiftSlots.branchId, ctx.branchId), eq(shiftSlots.key, key)];
  if (input.id) conds.push(ne(shiftSlots.id, input.id));
  const [dup] = await db.select({ id: shiftSlots.id }).from(shiftSlots).where(and(...conds)).limit(1);
  if (dup) throw new ValidationError(`타임 키 '${key}'가 이미 있습니다`);
  const vals = { key, label: input.label.trim(), startTime: input.startTime, endTime: input.endTime, hours: input.hoursX100, weekend: input.weekend, sort: input.sort, active: input.active };
  if (input.id) {
    const [existing] = await db.select().from(shiftSlots).where(and(eq(shiftSlots.id, input.id), eq(shiftSlots.branchId, ctx.branchId))).limit(1);
    if (!existing) throw new NotFoundError("타임을 찾을 수 없습니다");
    await db.update(shiftSlots).set(vals).where(eq(shiftSlots.id, input.id));
    return input.id;
  }
  const [row] = await db.insert(shiftSlots).values({ ...vals, branchId: ctx.branchId }).returning({ id: shiftSlots.id });
  return row.id;
}

export type StaffProfileInput = { userId: string; employmentType: string; hourlyRate: number | null; workDays: string | null; direct: boolean; targetHoursX100?: number | null; weeklyTargetHoursX100?: number | null };

export async function upsertStaffProfile(ctx: Ctx, input: StaffProfileInput, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...MANAGER_ROLES);
  const [ms] = await db.select().from(memberships).where(and(eq(memberships.userId, input.userId), eq(memberships.branchId, ctx.branchId))).limit(1);
  if (!ms) throw new NotFoundError("이 지점 소속 사용자가 아닙니다");
  if (input.hourlyRate !== null && (!Number.isInteger(input.hourlyRate) || input.hourlyRate < 0)) throw new ValidationError("시급은 0 이상의 정수");
  if (input.targetHoursX100 !== null && input.targetHoursX100 !== undefined && (input.targetHoursX100 < 0 || input.targetHoursX100 > 2400)) throw new ValidationError("하루 근무 예정 시간은 0~24시간");
  if (input.weeklyTargetHoursX100 !== null && input.weeklyTargetHoursX100 !== undefined && (input.weeklyTargetHoursX100 < 0 || input.weeklyTargetHoursX100 > 16800)) throw new ValidationError("주 소정근로시간은 0~168시간");
  const vals = { branchId: ctx.branchId, employmentType: input.employmentType, hourlyRate: input.hourlyRate, workDays: input.workDays, direct: input.direct, targetHoursX100: input.targetHoursX100 ?? null, weeklyTargetHoursX100: input.weeklyTargetHoursX100 ?? null };
  await db
    .insert(staffProfiles)
    .values({ userId: input.userId, ...vals })
    .onConflictDoUpdate({ target: staffProfiles.userId, set: vals });
}

export type StaffRow = { userId: string; name: string; role: string; employmentType: string; hourlyRate: number | null; workDays: string | null; direct: boolean; targetHoursX100: number | null; weeklyTargetHoursX100: number | null; hasProfile: boolean };

export async function listStaff(ctx: Ctx, db: Db = defaultDb): Promise<StaffRow[]> {
  const rows = await db
    .select({ userId: users.id, name: users.name, role: memberships.role, employmentType: staffProfiles.employmentType, hourlyRate: staffProfiles.hourlyRate, workDays: staffProfiles.workDays, direct: staffProfiles.direct, targetHoursX100: staffProfiles.targetHoursX100, weeklyTargetHoursX100: staffProfiles.weeklyTargetHoursX100 })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .where(and(eq(memberships.branchId, ctx.branchId), eq(users.active, true)));
  return rows
    .map((r) => ({ ...r, employmentType: r.employmentType ?? (r.role === "assistant" ? "주간조교" : r.role === "mentor" ? "컨설팅" : "원장"), direct: r.direct ?? true, targetHoursX100: r.targetHoursX100 ?? null, weeklyTargetHoursX100: r.weeklyTargetHoursX100 ?? null, hasProfile: r.employmentType !== null }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export type WorkLogInput = { userId?: string; date: string; slotKeys: string[]; overtimeX100: number; overtimeReason: string | null; note: string | null };
export type WorkLogRow = typeof workLogs.$inferSelect;

export async function saveWorkLog(ctx: Ctx, input: WorkLogInput, db: Db = defaultDb): Promise<string> {
  const userId = input.userId ?? ctx.userId;
  if (userId !== ctx.userId) requireRole(ctx, ...MANAGER_ROLES);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ValidationError("날짜 형식 오류");
  if (!Number.isInteger(input.overtimeX100) || input.overtimeX100 < 0) throw new ValidationError("초과근무 시간이 올바르지 않습니다");
  if (input.overtimeX100 > 0 && !input.overtimeReason?.trim()) throw new ValidationError("초과근무는 사유를 입력해야 합니다");
  const [ms] = await db.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.branchId, ctx.branchId))).limit(1);
  if (!ms) throw new NotFoundError("이 지점 소속 사용자가 아닙니다");

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(workLogs).where(and(eq(workLogs.branchId, ctx.branchId), eq(workLogs.userId, userId), eq(workLogs.date, input.date))).limit(1);
    if (existing?.hqConfirmedAt) throw new ValidationError("본사 확인이 완료된 근무는 수정할 수 없습니다");
    const slots = await listShiftSlots(ctx, db);
    // 출근·퇴근을 모두 누른 날은 시계가 잰 시간이 사실이다. 타임 체크를 고쳐도 시간을 되돌리지 않는다.
    const clocked = existing?.clockInAt && existing?.clockOutAt;
    const hoursX100 = clocked ? existing.hoursX100 : computeHoursX100(slots.map((s) => ({ key: s.key, hoursX100: s.hours, weekend: s.weekend })), input.slotKeys);
    const vals = { slotKeys: input.slotKeys, hoursX100, overtimeX100: input.overtimeX100, overtimeReason: input.overtimeX100 > 0 ? input.overtimeReason?.trim() ?? null : null, note: input.note?.trim() || null };
    const [row] = await tx
      .insert(workLogs)
      .values({ branchId: ctx.branchId, userId, date: input.date, ...vals })
      .onConflictDoUpdate({ target: [workLogs.branchId, workLogs.userId, workLogs.date], set: { ...vals, updatedAt: new Date() } })
      .returning({ id: workLogs.id });
    if (userId !== ctx.userId) await writeAudit(tx, ctx, "work_log", row.id, existing ? "update" : "create", existing ? { slotKeys: existing.slotKeys, overtimeX100: existing.overtimeX100 } : null, { ...vals, userId, date: input.date });
    return row.id;
  });
}

/**
 * 지금 근무 중인지, 게이지가 어디까지 찼는지. 대시보드와 근무 화면이 같이 쓴다.
 * 경과 시간은 화면에서 1초마다 다시 세므로 여기서는 기준 시각만 넘긴다.
 */
export type WorkClockState = {
  date: string;
  userName: string;
  /** 주간조교·컨설팅 같은 근무 형태. 카드에 이름표로 붙는다 */
  employmentType: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  /** 이미 기록된 인정 시간 ×100 (퇴근을 눌렀거나 타임을 체크한 경우) */
  hoursX100: number;
  targetHoursX100: number;
  /** 본사 확인이 끝나면 더 이상 누를 수 없다 */
  locked: boolean;
  /** 서버가 이 화면을 그린 시각. 첫 그림과 브라우저의 첫 그림이 어긋나지 않게 기준을 맞춘다 */
  nowIso: string;
  week: {
    startDate: string;
    endDate: string;
    /** 이번 주에 이미 기록된 시간 ×100 (오늘 근무 중인 시간은 뺀 값 — 화면에서 더한다) */
    workedX100: number;
    overtimeX100: number;
    targetX100: number;
  };
};

/**
 * 지점에 소속되지 않은 사람(본사 관리자)은 출퇴근을 찍지 않으므로 null 을 준다.
 * 화면마다 조건을 따로 쓰면 한 곳을 빠뜨린다 — 실제로 근무 화면이 그랬다.
 */
export async function myWorkClock(ctx: Ctx, date: string, db: Db = defaultDb): Promise<WorkClockState | null> {
  const [ms] = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.userId, ctx.userId), eq(memberships.branchId, ctx.branchId))).limit(1);
  if (!ms) return null;
  const from = toDateKey(weekStart(date));
  const to = toDateKey(addDays(from, 6));
  const [weekRows, profileRows] = await Promise.all([
    db
      .select()
      .from(workLogs)
      .where(and(eq(workLogs.branchId, ctx.branchId), eq(workLogs.userId, ctx.userId), gte(workLogs.date, from), lte(workLogs.date, to))),
    db.select({ target: staffProfiles.targetHoursX100, weekly: staffProfiles.weeklyTargetHoursX100, employmentType: staffProfiles.employmentType }).from(staffProfiles).where(eq(staffProfiles.userId, ctx.userId)).limit(1),
  ]);
  const profile = profileRows[0];
  const row = weekRows.find((r) => r.date === date);
  const target = profile?.target ?? DEFAULT_TARGET_HOURS_X100;
  // 오늘 근무 중인 시간은 아직 기록에 없다. 화면에서 흐르는 시간을 더해 보여 준다.
  const workedX100 = weekRows.reduce((a, r) => a + r.hoursX100, 0);
  return {
    date,
    userName: ctx.userName,
    employmentType: profile?.employmentType ?? (ms.role === "assistant" ? "주간조교" : ms.role === "mentor" ? "컨설팅" : "원장"),
    clockInAt: row?.clockInAt?.toISOString() ?? null,
    clockOutAt: row?.clockOutAt?.toISOString() ?? null,
    hoursX100: row?.hoursX100 ?? 0,
    targetHoursX100: target,
    locked: Boolean(row?.hqConfirmedAt),
    nowIso: new Date().toISOString(),
    week: {
      startDate: from,
      endDate: to,
      workedX100,
      overtimeX100: weekRows.reduce((a, r) => a + r.overtimeX100, 0),
      targetX100: profile?.weekly ?? target * 5,
    },
  };
}

/** 출근. 이미 근무 중이면 아무 일도 하지 않는다(두 번 눌러도 시작 시각이 밀리지 않게) */
export async function clockIn(ctx: Ctx, date: string, now = new Date(), db: Db = defaultDb): Promise<void> {
  await assertBranchMember(ctx, ctx.userId, db);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("날짜 형식 오류");
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(workLogs).where(and(eq(workLogs.branchId, ctx.branchId), eq(workLogs.userId, ctx.userId), eq(workLogs.date, date))).limit(1);
    if (existing?.hqConfirmedAt) throw new ValidationError("본사 확인이 완료된 근무는 고칠 수 없습니다");
    if (existing?.clockInAt && !existing.clockOutAt) return; // 이미 근무 중
    // 퇴근을 눌렀다가 다시 출근하면 처음 출근 시각을 유지하고 퇴근만 지운다.
    // 실수로 퇴근을 누른 경우이므로 총 근무 시간이 끊기지 않아야 한다.
    const vals = existing?.clockInAt ? { clockOutAt: null } : { clockInAt: now, clockOutAt: null };
    await tx
      .insert(workLogs)
      .values({ branchId: ctx.branchId, userId: ctx.userId, date, clockInAt: now })
      .onConflictDoUpdate({ target: [workLogs.branchId, workLogs.userId, workLogs.date], set: { ...vals, updatedAt: now } });
  });
}

/** 퇴근. 출근 시각부터 지금까지를 인정 시간으로 적는다 */
export async function clockOut(ctx: Ctx, date: string, now = new Date(), db: Db = defaultDb): Promise<number> {
  await assertBranchMember(ctx, ctx.userId, db);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(workLogs).where(and(eq(workLogs.branchId, ctx.branchId), eq(workLogs.userId, ctx.userId), eq(workLogs.date, date))).limit(1);
    if (!existing?.clockInAt) throw new ValidationError("출근을 먼저 눌러야 합니다");
    if (existing.hqConfirmedAt) throw new ValidationError("본사 확인이 완료된 근무는 고칠 수 없습니다");
    if (existing.clockOutAt) return existing.hoursX100; // 이미 퇴근
    const hoursX100 = elapsedToHoursX100(existing.clockInAt.getTime(), now.getTime());
    await tx.update(workLogs).set({ clockOutAt: now, hoursX100, updatedAt: now }).where(eq(workLogs.id, existing.id));
    return hoursX100;
  });
}

async function assertBranchMember(ctx: Ctx, userId: string, db: Db): Promise<void> {
  const [ms] = await db.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.branchId, ctx.branchId))).limit(1);
  if (!ms) throw new ForbiddenError("이 지점 소속 사용자만 출퇴근을 기록할 수 있습니다");
}

export async function myWorkLog(ctx: Ctx, date: string, db: Db = defaultDb): Promise<WorkLogRow | null> {
  const [row] = await db.select().from(workLogs).where(and(eq(workLogs.branchId, ctx.branchId), eq(workLogs.userId, ctx.userId), eq(workLogs.date, date))).limit(1);
  return row ?? null;
}

export type DailyWorkRow = WorkLogRow & { userName: string; employmentType: string; hqConfirmedByName: string | null };

export async function dailyWorkLogs(ctx: Ctx, date: string, db: Db = defaultDb): Promise<DailyWorkRow[]> {
  requireRole(ctx, ...MANAGER_ROLES);
  const rows = await db
    .select({ w: workLogs, userName: users.name, employmentType: staffProfiles.employmentType })
    .from(workLogs)
    .innerJoin(users, eq(users.id, workLogs.userId))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, workLogs.userId))
    .where(and(eq(workLogs.branchId, ctx.branchId), eq(workLogs.date, date)));
  const confirmerIds = [...new Set(rows.map((r) => r.w.hqConfirmedBy).filter((x): x is string => Boolean(x)))];
  const confirmers = confirmerIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, confirmerIds)) : [];
  const nameById = new Map(confirmers.map((c) => [c.id, c.name]));
  return rows
    .map((r) => ({ ...r.w, userName: r.userName, employmentType: r.employmentType ?? "-", hqConfirmedByName: r.w.hqConfirmedBy ? (nameById.get(r.w.hqConfirmedBy) ?? null) : null }))
    .sort((a, b) => a.userName.localeCompare(b.userName, "ko"));
}

export async function confirmWorkLog(ctx: Ctx, id: string, db: Db = defaultDb): Promise<void> {
  if (ctx.role !== "hq_admin") throw new ForbiddenError("본사 확인은 본사 관리자만 할 수 있습니다");
  const [row] = await db.select().from(workLogs).where(and(eq(workLogs.id, id), eq(workLogs.branchId, ctx.branchId))).limit(1);
  if (!row) throw new NotFoundError("근무 기록을 찾을 수 없습니다");
  await db.update(workLogs).set({ hqConfirmedBy: ctx.userId, hqConfirmedAt: new Date() }).where(eq(workLogs.id, id));
}

export async function unconfirmWorkLog(ctx: Ctx, id: string, db: Db = defaultDb): Promise<void> {
  if (ctx.role !== "hq_admin") throw new ForbiddenError("본사 확인은 본사 관리자만 할 수 있습니다");
  await db.update(workLogs).set({ hqConfirmedBy: null, hqConfirmedAt: null }).where(and(eq(workLogs.id, id), eq(workLogs.branchId, ctx.branchId)));
}

export type MonthlyRow = { userId: string; userName: string; employmentType: string; days: number; hoursX100: number; overtimeX100: number; confirmedX100: number; hourlyRate: number | null; estimatedPay: number | null };

export async function monthlySummary(ctx: Ctx, yearMonth: string, db: Db = defaultDb): Promise<MonthlyRow[]> {
  requireRole(ctx, ...MANAGER_ROLES);
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new ValidationError("월 형식 오류");
  const dates = monthDates(yearMonth);
  const rows = await db
    .select({ w: workLogs, userName: users.name, employmentType: staffProfiles.employmentType, hourlyRate: staffProfiles.hourlyRate })
    .from(workLogs)
    .innerJoin(users, eq(users.id, workLogs.userId))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, workLogs.userId))
    .where(and(eq(workLogs.branchId, ctx.branchId), gte(workLogs.date, dates[0]), lte(workLogs.date, dates[dates.length - 1])));
  const map = new Map<string, MonthlyRow>();
  for (const r of rows) {
    const cur = map.get(r.w.userId) ?? { userId: r.w.userId, userName: r.userName, employmentType: r.employmentType ?? "-", days: 0, hoursX100: 0, overtimeX100: 0, confirmedX100: 0, hourlyRate: r.hourlyRate, estimatedPay: null };
    cur.days += 1;
    cur.hoursX100 += r.w.hoursX100;
    cur.overtimeX100 += r.w.overtimeX100;
    if (r.w.hqConfirmedAt) cur.confirmedX100 += r.w.hoursX100 + r.w.overtimeX100;
    map.set(r.w.userId, cur);
  }
  return [...map.values()]
    .map((r) => ({ ...r, estimatedPay: r.hourlyRate === null ? null : Math.round(((r.hoursX100 + r.overtimeX100) / 100) * r.hourlyRate) }))
    .sort((a, b) => a.userName.localeCompare(b.userName, "ko"));
}

export async function monthLogsForUser(ctx: Ctx, userId: string, yearMonth: string, db: Db = defaultDb): Promise<WorkLogRow[]> {
  if (userId !== ctx.userId) requireRole(ctx, ...MANAGER_ROLES);
  const dates = monthDates(yearMonth);
  return db
    .select()
    .from(workLogs)
    .where(and(eq(workLogs.branchId, ctx.branchId), eq(workLogs.userId, userId), gte(workLogs.date, dates[0]), lte(workLogs.date, dates[dates.length - 1])))
    .orderBy(asc(workLogs.date));
}

export type BranchWorkSummary = { branchId: string; branchName: string; staff: number; hoursX100: number; overtimeX100: number; confirmedX100: number; estimatedPay: number };

/** 본사용 지점별 월 근무 집계 */
export async function hqWorklogSummary(ctx: Ctx, yearMonth: string, db: Db = defaultDb): Promise<BranchWorkSummary[]> {
  if (!ctx.isHqAdmin) throw new ForbiddenError("본사 관리자만 볼 수 있습니다");
  const { branches } = await import("@/db/schema");
  const list = await db.select({ id: branches.id, name: branches.name, settings: branches.settings }).from(branches).where(eq(branches.active, true)).orderBy(asc(branches.code));
  const out: BranchWorkSummary[] = [];
  for (const b of list) {
    const rows = await monthlySummary({ ...ctx, branchId: b.id, branchName: b.name, settings: b.settings }, yearMonth, db);
    out.push({
      branchId: b.id,
      branchName: b.name,
      staff: rows.length,
      hoursX100: rows.reduce((a, r) => a + r.hoursX100, 0),
      overtimeX100: rows.reduce((a, r) => a + r.overtimeX100, 0),
      confirmedX100: rows.reduce((a, r) => a + r.confirmedX100, 0),
      estimatedPay: rows.reduce((a, r) => a + (r.estimatedPay ?? 0), 0),
    });
  }
  return out;
}
