import { and, asc, desc, eq, isNull, ne, or } from "drizzle-orm";
import { db as defaultDb, type Db, type Tx } from "@/db/client";
import { auditLogs, boardItems, branches, customFieldDefs, memberships, penaltyRules, seats, users, type BoardItemKind, type BranchRole, type BranchSettings } from "@/db/schema";
import { CUSTOM_FIELD_TYPES, type CustomFieldType } from "@/lib/rules/custom-fields";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { MANAGER_ROLES, requireRole, type Ctx } from "@/lib/auth/ctx";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";

export type BoardItem = typeof boardItems.$inferSelect;

/** 지점 항목이 하나라도 있으면 지점 항목만, 없으면 본사 기본 */
export async function boardItemsFor(scope: Pick<Ctx, "branchId">, db: Db | Tx = defaultDb, includeInactive = false): Promise<BoardItem[]> {
  const conds = [or(eq(boardItems.branchId, scope.branchId), isNull(boardItems.branchId))];
  if (!includeInactive) conds.push(eq(boardItems.active, true));
  const rows = await db.select().from(boardItems).where(and(...conds)).orderBy(asc(boardItems.sort), asc(boardItems.label));
  const own = rows.filter((r) => r.branchId === scope.branchId);
  return own.length ? own : rows.filter((r) => r.branchId === null);
}

export async function getBranch(ctx: Ctx, db: Db = defaultDb) {
  const [b] = await db.select().from(branches).where(eq(branches.id, ctx.branchId)).limit(1);
  if (!b) throw new NotFoundError("지점을 찾을 수 없습니다");
  return b;
}

export async function updateBranchSettings(ctx: Ctx, patch: Partial<BranchSettings>, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...MANAGER_ROLES);
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(branches).where(eq(branches.id, ctx.branchId)).limit(1);
    if (!b) throw new NotFoundError("지점을 찾을 수 없습니다");
    const next: BranchSettings = { ...b.settings, ...patch };
    if (!Number.isInteger(next.roundsPerDay) || next.roundsPerDay < 1 || next.roundsPerDay > 24) {
      throw new ValidationError("하루 회차 수는 1~24 사이여야 합니다");
    }
    await tx.update(branches).set({ settings: next }).where(eq(branches.id, ctx.branchId));
    await writeAudit(tx, ctx, "branch", ctx.branchId, "update", b.settings, next);
  });
}

export type PenaltyRuleInput = { id?: string; name: string; points: number; sort: number; active: boolean; /** 본사 관리자만: 전 지점 기본 규칙 */ global?: boolean };

export async function listPenaltyRulesForSettings(ctx: Ctx, db: Db = defaultDb) {
  return db
    .select()
    .from(penaltyRules)
    .where(or(eq(penaltyRules.branchId, ctx.branchId), isNull(penaltyRules.branchId)))
    .orderBy(asc(penaltyRules.branchId), asc(penaltyRules.sort));
}

export async function upsertPenaltyRule(ctx: Ctx, input: PenaltyRuleInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...MANAGER_ROLES);
  if (input.global && ctx.role !== "hq_admin") throw new ForbiddenError("기본 규칙은 본사 관리자만 수정할 수 있습니다");
  if (!input.name.trim()) throw new ValidationError("규칙 이름을 입력하세요");
  if (!Number.isInteger(input.points) || input.points < 0) throw new ValidationError("점수는 0 이상의 정수");
  const branchId = input.global ? null : ctx.branchId;
  const vals = { name: input.name.trim(), points: input.points, sort: input.sort, active: input.active };
  if (input.id) {
    const [existing] = await db.select().from(penaltyRules).where(eq(penaltyRules.id, input.id)).limit(1);
    if (!existing) throw new NotFoundError("규칙을 찾을 수 없습니다");
    if (existing.branchId === null && ctx.role !== "hq_admin") throw new ForbiddenError("기본 규칙은 본사 관리자만 수정할 수 있습니다");
    if (existing.branchId !== null && existing.branchId !== ctx.branchId) throw new NotFoundError("규칙을 찾을 수 없습니다");
    await db.update(penaltyRules).set(vals).where(eq(penaltyRules.id, input.id));
    return input.id;
  }
  const [row] = await db.insert(penaltyRules).values({ ...vals, branchId }).returning({ id: penaltyRules.id });
  return row.id;
}

export type SeatInput = { id?: string; seatNo: number; zone: string; sort: number; active: boolean };

export async function listSeats(ctx: Ctx, db: Db = defaultDb) {
  return db.select().from(seats).where(eq(seats.branchId, ctx.branchId)).orderBy(asc(seats.sort), asc(seats.seatNo));
}

export async function upsertSeat(ctx: Ctx, input: SeatInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...MANAGER_ROLES);
  if (!Number.isInteger(input.seatNo) || input.seatNo < 1) throw new ValidationError("좌석번호는 1 이상의 정수");
  const conds = [eq(seats.branchId, ctx.branchId), eq(seats.seatNo, input.seatNo)];
  if (input.id) conds.push(ne(seats.id, input.id));
  const [dup] = await db.select({ id: seats.id }).from(seats).where(and(...conds)).limit(1);
  if (dup) throw new ValidationError(`${input.seatNo}번 좌석이 이미 있습니다`);
  const vals = { seatNo: input.seatNo, zone: input.zone.trim() || "A", sort: input.sort, active: input.active };
  if (input.id) {
    const [existing] = await db.select().from(seats).where(and(eq(seats.id, input.id), eq(seats.branchId, ctx.branchId))).limit(1);
    if (!existing) throw new NotFoundError("좌석을 찾을 수 없습니다");
    await db.update(seats).set(vals).where(eq(seats.id, input.id));
    return input.id;
  }
  const [row] = await db.insert(seats).values({ ...vals, branchId: ctx.branchId }).returning({ id: seats.id });
  return row.id;
}

export async function bulkCreateSeats(ctx: Ctx, from: number, to: number, zone: string, db: Db = defaultDb): Promise<number> {
  requireRole(ctx, ...MANAGER_ROLES);
  if (from < 1 || to < from || to - from > 500) throw new ValidationError("범위가 올바르지 않습니다");
  const existing = new Set((await listSeats(ctx, db)).map((s) => s.seatNo));
  const values = [];
  for (let n = from; n <= to; n++) if (!existing.has(n)) values.push({ branchId: ctx.branchId, seatNo: n, zone: zone.trim() || "A", sort: n });
  if (values.length) await db.insert(seats).values(values);
  return values.length;
}

export type BoardItemInput = { id?: string; key: string; label: string; kind: BoardItemKind; sort: number; active: boolean; global?: boolean };

export async function upsertBoardItem(ctx: Ctx, input: BoardItemInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...MANAGER_ROLES);
  if (input.global && ctx.role !== "hq_admin") throw new ForbiddenError("기본 항목은 본사 관리자만 수정할 수 있습니다");
  const key = input.key.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(key)) throw new ValidationError("키는 영문 소문자·숫자·밑줄 2~31자");
  if (!input.label.trim()) throw new ValidationError("표시 이름을 입력하세요");
  const vals = { key, label: input.label.trim(), kind: input.kind, sort: input.sort, active: input.active };
  if (input.id) {
    const [existing] = await db.select().from(boardItems).where(eq(boardItems.id, input.id)).limit(1);
    if (!existing) throw new NotFoundError("항목을 찾을 수 없습니다");
    if (existing.branchId === null && ctx.role !== "hq_admin") throw new ForbiddenError("기본 항목은 본사 관리자만 수정할 수 있습니다");
    if (existing.branchId !== null && existing.branchId !== ctx.branchId) throw new NotFoundError("항목을 찾을 수 없습니다");
    await db.update(boardItems).set(vals).where(eq(boardItems.id, input.id));
    return input.id;
  }
  const [row] = await db.insert(boardItems).values({ ...vals, branchId: input.global ? null : ctx.branchId }).returning({ id: boardItems.id });
  return row.id;
}

export type UserInput = { id?: string; loginId: string; name: string; password?: string; role: BranchRole; active: boolean; phone?: string | null };
export type UserRow = { id: string; loginId: string; name: string; phone: string | null; role: BranchRole; active: boolean; hasPin: boolean };

export async function listUsers(ctx: Ctx, db: Db = defaultDb): Promise<UserRow[]> {
  requireRole(ctx, ...MANAGER_ROLES);
  const rows = await db
    .select({ id: users.id, loginId: users.loginId, name: users.name, phone: users.phone, role: memberships.role, active: users.active, pinHash: users.pinHash })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.branchId, ctx.branchId))
    .orderBy(asc(memberships.role), asc(users.name));
  return rows.map(({ pinHash, ...r }) => ({ ...r, hasPin: Boolean(pinHash) }));
}

const BM_ALLOWED: BranchRole[] = ["mentor", "assistant"];

export async function upsertUser(ctx: Ctx, input: UserInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...MANAGER_ROLES);
  if (ctx.role === "branch_manager" && !BM_ALLOWED.includes(input.role)) throw new ForbiddenError("지점장은 멘토·조교 계정만 관리할 수 있습니다");
  const loginId = input.loginId.trim();
  if (!/^[a-z0-9_.-]{3,30}$/i.test(loginId)) throw new ValidationError("아이디는 영문·숫자 3~30자");
  if (!input.name.trim()) throw new ValidationError("이름을 입력하세요");
  if (input.password !== undefined && input.password.length < 6) throw new ValidationError("비밀번호는 6자 이상");

  return db.transaction(async (tx) => {
    const dupConds = [eq(users.loginId, loginId)];
    if (input.id) dupConds.push(ne(users.id, input.id));
    const [dup] = await tx.select({ id: users.id }).from(users).where(and(...dupConds)).limit(1);
    if (dup) throw new ValidationError("이미 사용 중인 아이디입니다");

    if (input.id) {
      const [ms] = await tx.select().from(memberships).where(and(eq(memberships.userId, input.id), eq(memberships.branchId, ctx.branchId))).limit(1);
      if (!ms) throw new NotFoundError("사용자를 찾을 수 없습니다");
      if (ctx.role === "branch_manager" && !BM_ALLOWED.includes(ms.role)) throw new ForbiddenError("지점장은 멘토·조교 계정만 관리할 수 있습니다");
      const set: Partial<typeof users.$inferInsert> = { loginId, name: input.name.trim(), active: input.active, phone: input.phone ?? null };
      if (input.password) set.passwordHash = await hashPassword(input.password);
      await tx.update(users).set(set).where(eq(users.id, input.id));
      await tx.update(memberships).set({ role: input.role }).where(and(eq(memberships.userId, input.id), eq(memberships.branchId, ctx.branchId)));
      await writeAudit(tx, ctx, "user", input.id, "update", { role: ms.role }, { role: input.role, active: input.active });
      return input.id;
    }
    if (!input.password) throw new ValidationError("비밀번호를 입력하세요");
    const [u] = await tx
      .insert(users)
      .values({ loginId, name: input.name.trim(), passwordHash: await hashPassword(input.password), active: input.active, phone: input.phone ?? null })
      .returning({ id: users.id });
    await tx.insert(memberships).values({ userId: u.id, branchId: ctx.branchId, role: input.role });
    await writeAudit(tx, ctx, "user", u.id, "create", null, { loginId, role: input.role });
    return u.id;
  });
}

export async function setUserPin(ctx: Ctx, userId: string, pin: string | null, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, ...MANAGER_ROLES);
  if (pin !== null && !/^\d{4,6}$/.test(pin)) throw new ValidationError("PIN은 숫자 4~6자리");
  const [ms] = await db.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.branchId, ctx.branchId))).limit(1);
  if (!ms) throw new NotFoundError("사용자를 찾을 수 없습니다");
  await db.update(users).set({ pinHash: pin ? await hashPassword(pin) : null }).where(eq(users.id, userId));
}

// ---------- 커스텀 필드 ----------
export type CustomFieldDef = Omit<typeof customFieldDefs.$inferSelect, "type"> & { type: CustomFieldType };
export type CustomFieldEntity = "member" | "counsel_log" | "issue";
export const CUSTOM_FIELD_ENTITY_LABEL: Record<CustomFieldEntity, string> = { member: "회원", counsel_log: "상담일지", issue: "이슈" };
const RESERVED_KEYS = new Set(["id", "name", "phone", "status", "seatId", "seat_id", "custom", "branchId", "branch_id", "memberId", "member_id"]);

/** 본사 기본(전 지점) + 지점 전용 정의를 합쳐 순서대로 */
export async function customFieldsFor(scope: Pick<Ctx, "branchId">, entity: CustomFieldEntity, db: Db | Tx = defaultDb): Promise<CustomFieldDef[]> {
  const rows = await db
    .select()
    .from(customFieldDefs)
    .where(and(eq(customFieldDefs.entity, entity), eq(customFieldDefs.active, true), or(eq(customFieldDefs.branchId, scope.branchId), isNull(customFieldDefs.branchId))))
    .orderBy(asc(customFieldDefs.sort), asc(customFieldDefs.label));
  return rows as CustomFieldDef[];
}

export async function listCustomFieldDefs(ctx: Ctx, db: Db = defaultDb): Promise<CustomFieldDef[]> {
  requireRole(ctx, "hq_admin");
  const rows = await db.select().from(customFieldDefs).orderBy(asc(customFieldDefs.entity), asc(customFieldDefs.sort), asc(customFieldDefs.label));
  return rows as CustomFieldDef[];
}

export type CustomFieldInput = { id?: string; entity: CustomFieldEntity; key: string; label: string; type: CustomFieldType; options: string[]; required: boolean; sort: number; active: boolean; branchId?: string | null };

export async function upsertCustomFieldDef(ctx: Ctx, input: CustomFieldInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, "hq_admin");
  const key = input.key.trim();
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(key)) throw new ValidationError("키는 영문 소문자로 시작하는 영문·숫자·밑줄 2~31자");
  if (RESERVED_KEYS.has(key)) throw new ValidationError("예약된 키입니다");
  if (!input.label.trim()) throw new ValidationError("표시 이름을 입력하세요");
  if (!CUSTOM_FIELD_TYPES.includes(input.type)) throw new ValidationError("필드 유형이 올바르지 않습니다");
  const options = input.options.map((o) => o.trim()).filter(Boolean);
  if ((input.type === "select" || input.type === "multiselect") && options.length === 0) throw new ValidationError("선택지를 하나 이상 입력하세요");
  const vals = { entity: input.entity, key, label: input.label.trim(), type: input.type, options, required: input.required, sort: input.sort, active: input.active, branchId: input.branchId ?? null };
  if (input.id) {
    const [existing] = await db.select().from(customFieldDefs).where(eq(customFieldDefs.id, input.id)).limit(1);
    if (!existing) throw new NotFoundError("필드를 찾을 수 없습니다");
    await db.update(customFieldDefs).set(vals).where(eq(customFieldDefs.id, input.id));
    return input.id;
  }
  const [dup] = await db
    .select({ id: customFieldDefs.id })
    .from(customFieldDefs)
    .where(and(eq(customFieldDefs.entity, input.entity), eq(customFieldDefs.key, key)))
    .limit(1);
  if (dup) throw new ValidationError("같은 키의 필드가 이미 있습니다");
  const [row] = await db.insert(customFieldDefs).values(vals).returning({ id: customFieldDefs.id });
  return row.id;
}

// ---------- 감사 로그 ----------
export type AuditRow = typeof auditLogs.$inferSelect & { actorName: string | null };

export async function listAuditLogs(ctx: Ctx, limit = 200, db: Db = defaultDb): Promise<AuditRow[]> {
  requireRole(ctx, ...MANAGER_ROLES);
  const rows = await db
    .select({ a: auditLogs, actorName: users.name })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(eq(auditLogs.branchId, ctx.branchId))
    .orderBy(desc(auditLogs.at))
    .limit(limit);
  return rows.map((r) => ({ ...r.a, actorName: r.actorName }));
}
