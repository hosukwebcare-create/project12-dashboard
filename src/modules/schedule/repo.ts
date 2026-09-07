import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { counselAppointments, members, users, type AppointmentKind, type AppointmentStatus } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { requireRole, STAFF_ROLES, type Ctx } from "@/lib/auth/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, toDateKey, weekDays, weekStart } from "@/lib/rules/week";
import { notify } from "@/modules/notifications/repo";

/**
 * 상담 일정. 시트의 '상담일정표'(주 × 시간대 × 요일)를 그대로 옮긴 것이다.
 * 신규 상담은 아직 회원이 아니라 이름·연락처만으로 잡고, 재상담은 회원에 연결한다.
 */
export const APPOINTMENT_KINDS: { key: AppointmentKind; label: string }[] = [
  { key: "new", label: "신규 상담" },
  { key: "member", label: "재상담" },
  { key: "guardian", label: "학부모 상담" },
];
export const KIND_LABEL: Record<AppointmentKind, string> = { new: "신규 상담", member: "재상담", guardian: "학부모 상담" };

export const APPOINTMENT_STATUSES: { key: AppointmentStatus; label: string }[] = [
  { key: "scheduled", label: "예정" },
  { key: "done", label: "완료" },
  { key: "canceled", label: "취소" },
  { key: "noshow", label: "불참" },
];
export const STATUS_LABEL: Record<AppointmentStatus, string> = { scheduled: "예정", done: "완료", canceled: "취소", noshow: "불참" };

/** 시트가 쓰던 네 구간. 시작 시각이 어느 칸에 들어가는지 정한다 */
export const TIME_BANDS = [
  { key: "am", label: "08:00 ~ 12:00", from: "08:00", to: "12:00" },
  { key: "pm1", label: "13:00 ~ 17:00", from: "13:00", to: "17:00" },
  { key: "pm2", label: "17:00 ~ 19:00", from: "17:00", to: "19:00" },
  { key: "eve", label: "19:00 ~ 22:00", from: "19:00", to: "22:00" },
] as const;
export type BandKey = (typeof TIME_BANDS)[number]["key"] | "etc";

/** 시작 시각을 시간대 칸으로. 어느 칸에도 안 들어가면 '그 밖' 줄에 모은다 */
export function bandOf(startTime: string): BandKey {
  for (const b of TIME_BANDS) if (startTime >= b.from && startTime < b.to) return b.key;
  return "etc";
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type AppointmentRow = typeof counselAppointments.$inferSelect & {
  /** 회원이면 회원 이름, 신규면 적어 둔 이름 */
  displayName: string;
  assigneeName: string | null;
};

export type AppointmentInput = {
  id?: string;
  date: string;
  startTime: string;
  endTime?: string | null;
  kind: AppointmentKind;
  memberId?: string | null;
  personName?: string | null;
  personPhone?: string | null;
  assignedTo?: string | null;
  note?: string | null;
  status?: AppointmentStatus;
};

async function decorate(rows: (typeof counselAppointments.$inferSelect)[], db: Db): Promise<AppointmentRow[]> {
  if (!rows.length) return [];
  const memberIds = [...new Set(rows.map((r) => r.memberId).filter((v): v is string => Boolean(v)))];
  const userIds = [...new Set(rows.map((r) => r.assignedTo).filter((v): v is string => Boolean(v)))];
  const [ms, us] = await Promise.all([
    memberIds.length ? db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, memberIds)) : Promise.resolve([]),
    userIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([]),
  ]);
  const mByeId = new Map(ms.map((m) => [m.id, m.name]));
  const uById = new Map(us.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    ...r,
    displayName: (r.memberId ? mByeId.get(r.memberId) : null) ?? r.personName ?? "(이름 없음)",
    assigneeName: r.assignedTo ? (uById.get(r.assignedTo) ?? null) : null,
  }));
}

/** 한 주(월~일)의 일정. 화면은 이 목록을 시간대 × 요일로 흩뿌린다 */
export async function weekAppointments(ctx: Ctx, anyDateInWeek: string, db: Db = defaultDb): Promise<{ days: string[]; rows: AppointmentRow[] }> {
  requireRole(ctx, ...STAFF_ROLES);
  const days = weekDays(weekStart(anyDateInWeek)).map(toDateKey);
  const rows = await db
    .select()
    .from(counselAppointments)
    .where(and(eq(counselAppointments.branchId, ctx.branchId), gte(counselAppointments.date, days[0]), lte(counselAppointments.date, days[6])))
    .orderBy(asc(counselAppointments.date), asc(counselAppointments.startTime));
  return { days, rows: await decorate(rows, db) };
}

/** 대시보드용: 오늘부터 n일 안의 예정 일정 */
export async function upcomingAppointments(ctx: Ctx, days = 7, today = toDateKey(new Date()), db: Db = defaultDb): Promise<AppointmentRow[]> {
  requireRole(ctx, ...STAFF_ROLES);
  const rows = await db
    .select()
    .from(counselAppointments)
    .where(
      and(
        eq(counselAppointments.branchId, ctx.branchId),
        eq(counselAppointments.status, "scheduled"),
        gte(counselAppointments.date, today),
        lte(counselAppointments.date, toDateKey(addDays(today, days))),
      ),
    )
    .orderBy(asc(counselAppointments.date), asc(counselAppointments.startTime))
    .limit(20);
  return decorate(rows, db);
}

export async function getAppointment(ctx: Ctx, id: string, db: Db = defaultDb): Promise<AppointmentRow> {
  requireRole(ctx, ...STAFF_ROLES);
  const [row] = await db
    .select()
    .from(counselAppointments)
    .where(and(eq(counselAppointments.id, id), eq(counselAppointments.branchId, ctx.branchId)))
    .limit(1);
  if (!row) throw new NotFoundError("상담 일정을 찾을 수 없습니다");
  return (await decorate([row], db))[0];
}

export async function upsertAppointment(ctx: Ctx, input: AppointmentInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...STAFF_ROLES);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ValidationError("날짜를 고르세요");
  if (!TIME_RE.test(input.startTime)) throw new ValidationError("시작 시각은 09:30 처럼 입력하세요");
  const endTime = input.endTime?.trim() || null;
  if (endTime && !TIME_RE.test(endTime)) throw new ValidationError("종료 시각은 09:30 처럼 입력하세요");
  if (endTime && endTime <= input.startTime) throw new ValidationError("종료 시각이 시작 시각보다 빠릅니다");
  const memberId = input.kind === "new" ? null : (input.memberId ?? null);
  const personName = input.personName?.trim() || null;
  if (!memberId && !personName) throw new ValidationError("회원을 고르거나 이름을 입력하세요");

  const vals = {
    date: input.date,
    startTime: input.startTime,
    endTime,
    kind: input.kind,
    memberId,
    personName,
    personPhone: input.personPhone?.trim() || null,
    assignedTo: input.assignedTo || null,
    note: input.note?.trim() || null,
    status: input.status ?? "scheduled",
  };

  if (input.id) {
    const before = await getAppointment(ctx, input.id, db);
    await db.update(counselAppointments).set(vals).where(eq(counselAppointments.id, input.id));
    await writeAudit(db, ctx, "counsel_appointment", input.id, "update", { date: before.date, startTime: before.startTime, status: before.status }, { date: vals.date, startTime: vals.startTime, status: vals.status });
    if (vals.assignedTo && vals.assignedTo !== before.assignedTo && vals.assignedTo !== ctx.userId) {
      await notify(db, [vals.assignedTo], "appointment", { title: `상담 일정 배정 · ${vals.date} ${vals.startTime}`, week: vals.date }, ctx.branchId);
    }
    return input.id;
  }
  const [row] = await db
    .insert(counselAppointments)
    .values({ ...vals, branchId: ctx.branchId, createdBy: ctx.userId })
    .returning({ id: counselAppointments.id });
  await writeAudit(db, ctx, "counsel_appointment", row.id, "create", null, { date: vals.date, startTime: vals.startTime, kind: vals.kind });
  if (vals.assignedTo && vals.assignedTo !== ctx.userId) {
    await notify(db, [vals.assignedTo], "appointment", { title: `상담 일정 배정 · ${vals.date} ${vals.startTime}`, week: vals.date }, ctx.branchId);
  }
  return row.id;
}

export async function deleteAppointment(ctx: Ctx, id: string, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, "hq_admin", "branch_manager");
  const before = await getAppointment(ctx, id, db);
  await db.delete(counselAppointments).where(and(eq(counselAppointments.id, id), eq(counselAppointments.branchId, ctx.branchId)));
  await writeAudit(db, ctx, "counsel_appointment", id, "delete", { date: before.date, startTime: before.startTime }, null);
}

/** 일정 화면의 회원·담당자 선택지 */
export async function schedulePickers(ctx: Ctx, db: Db = defaultDb): Promise<{ members: { id: string; name: string; seatNo: number | null }[]; staff: { id: string; name: string }[] }> {
  requireRole(ctx, ...STAFF_ROLES);
  const [ms, us] = await Promise.all([
    db
      .select({ id: members.id, name: members.name, seatNo: members.seatId })
      .from(members)
      .where(eq(members.branchId, ctx.branchId))
      .orderBy(asc(members.name))
      .limit(500),
    db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)),
  ]);
  return { members: ms.map((m) => ({ id: m.id, name: m.name, seatNo: null })), staff: us };
}

/** 최근 완료·취소 이력 (한 회원의 상담 흐름을 볼 때) */
export async function memberAppointments(ctx: Ctx, memberId: string, db: Db = defaultDb): Promise<AppointmentRow[]> {
  requireRole(ctx, ...STAFF_ROLES);
  const rows = await db
    .select()
    .from(counselAppointments)
    .where(and(eq(counselAppointments.branchId, ctx.branchId), eq(counselAppointments.memberId, memberId)))
    .orderBy(desc(counselAppointments.date))
    .limit(20);
  return decorate(rows, db);
}
