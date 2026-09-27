import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db as defaultDb, type Db, type Tx } from "@/db/client";
import { auditLogs, boardItems, branches, customFieldDefs, memberships, penaltyRules, seats, users, type BoardItemKind, type BranchRole, type BranchSettings } from "@/db/schema";
import { CUSTOM_FIELD_TYPES, type CustomFieldType } from "@/lib/rules/custom-fields";
import { writeAudit } from "@/lib/audit";
import { hashPassword, validatePassword } from "@/lib/auth/password";
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
  // 지점 항목이 하나라도 생기면 그 지점은 본사 기본 항목 대신 자기 항목만 쓴다.
  // 첫 항목을 만들 때 기본 항목을 먼저 지점으로 옮겨 두지 않으면 출석·라운딩 열이 한꺼번에 사라진다.
  if (!input.global) {
    const own = await db.select({ id: boardItems.id }).from(boardItems).where(eq(boardItems.branchId, ctx.branchId)).limit(1);
    if (!own.length) {
      const defaults = await db.select().from(boardItems).where(isNull(boardItems.branchId));
      const carry = defaults.filter((d) => d.key !== key);
      if (carry.length) await db.insert(boardItems).values(carry.map((d) => ({ branchId: ctx.branchId, key: d.key, label: d.label, kind: d.kind, sort: d.sort, active: d.active })));
    }
  }
  const [row] = await db.insert(boardItems).values({ ...vals, branchId: input.global ? null : ctx.branchId }).returning({ id: boardItems.id });
  return row.id;
}

export type UserInput = { id?: string; loginId: string; name: string; password?: string; role: BranchRole; active: boolean; phone?: string | null };
/** 지난 잠금은 없는 것과 같으므로 화면에는 아직 유효한 것만 내려보낸다 */
function stillLocked(until: Date | null): Date | null {
  return until && until.getTime() > Date.now() ? until : null;
}

export type UserRow = { id: string; loginId: string; name: string; phone: string | null; role: BranchRole; active: boolean; hasPin: boolean; lockedUntil: Date | null; /** 이 사람이 함께 맡고 있는 다른 지점 이름 */ otherBranches: string[] };

export async function listUsers(ctx: Ctx, db: Db = defaultDb): Promise<UserRow[]> {
  requireRole(ctx, ...MANAGER_ROLES);
  const rows = await db
    .select({ id: users.id, loginId: users.loginId, name: users.name, phone: users.phone, role: memberships.role, active: users.active, pinHash: users.pinHash, lockedUntil: users.lockedUntil })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.branchId, ctx.branchId))
    .orderBy(asc(memberships.role), asc(users.name));
  // 한 사람이 여러 지점을 맡을 수 있다(점주가 직영 2개를 보는 경우 등). 목록에 함께 보여 준다.
  const ids = rows.map((r) => r.id);
  const others = ids.length
    ? await db
        .select({ userId: memberships.userId, branchName: branches.name })
        .from(memberships)
        .innerJoin(branches, eq(branches.id, memberships.branchId))
        .where(and(inArray(memberships.userId, ids), ne(memberships.branchId, ctx.branchId)))
    : [];
  const byUser = new Map<string, string[]>();
  for (const o of others) byUser.set(o.userId, [...(byUser.get(o.userId) ?? []), o.branchName]);
  return rows.map(({ pinHash, ...r }) => ({ ...r, hasPin: Boolean(pinHash), lockedUntil: stillLocked(r.lockedUntil), otherBranches: byUser.get(r.id) ?? [] }));
}

/**
 * 이미 있는 계정을 이 지점에도 소속시킨다. 지점을 넘나드는 일이라 본사 관리자만 할 수 있다.
 * (설정 › 사용자의 '새 사용자'는 아이디 중복을 막으므로 같은 사람을 두 지점에 넣을 수 없다)
 */
export async function addUserToBranch(ctx: Ctx, loginId: string, role: BranchRole, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, "hq_admin");
  const id = loginId.trim();
  if (!id) throw new ValidationError("아이디를 입력하세요");
  const [user] = await db.select({ id: users.id, name: users.name, isHqAdmin: users.isHqAdmin }).from(users).where(eq(users.loginId, id)).limit(1);
  if (!user) throw new NotFoundError(`'${id}' 계정이 없습니다. 새 사용자로 먼저 만드세요`);
  if (user.isHqAdmin) throw new ValidationError("본사 관리자는 이미 모든 지점을 봅니다");
  const [already] = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.branchId, ctx.branchId))).limit(1);
  if (already) throw new ValidationError(`${user.name} 님은 이미 이 지점 소속입니다`);
  await db.insert(memberships).values({ userId: user.id, branchId: ctx.branchId, role });
  await writeAudit(db, ctx, "user", user.id, "update", null, { addedToBranch: ctx.branchName, role });
  return user.id;
}

/** 이 지점 소속에서만 뺀다(계정 자체는 남는다). 마지막 소속이면 갈 곳이 없어지므로 막는다 */
export async function removeUserFromBranch(ctx: Ctx, userId: string, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, "hq_admin");
  const rows = await db.select({ branchId: memberships.branchId }).from(memberships).where(eq(memberships.userId, userId));
  if (!rows.some((r) => r.branchId === ctx.branchId)) throw new NotFoundError("이 지점 소속이 아닙니다");
  if (rows.length < 2) throw new ValidationError("마지막 소속 지점입니다. 계정을 비활성으로 바꾸세요");
  await db.delete(memberships).where(and(eq(memberships.userId, userId), eq(memberships.branchId, ctx.branchId)));
  await writeAudit(db, ctx, "user", userId, "update", { branch: ctx.branchName }, { removedFromBranch: ctx.branchName });
}

const BM_ALLOWED: BranchRole[] = ["mentor", "assistant"];

export async function upsertUser(ctx: Ctx, input: UserInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...MANAGER_ROLES);
  if (ctx.role === "branch_manager" && !BM_ALLOWED.includes(input.role)) throw new ForbiddenError("지점장은 멘토·조교 계정만 관리할 수 있습니다");
  const loginId = input.loginId.trim();
  if (!/^[a-z0-9_.-]{3,30}$/i.test(loginId)) throw new ValidationError("아이디는 영문·숫자 3~30자");
  if (!input.name.trim()) throw new ValidationError("이름을 입력하세요");
  if (input.password !== undefined) {
    const err = validatePassword(input.password);
    if (err) throw new ValidationError(err);
  }

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
      if (input.password) {
        // 비밀번호를 바꾸면 그 계정으로 로그인된 기기의 세션이 모두 끊긴다 (buildCtx 가 발급 시각을 본다)
        set.passwordHash = await hashPassword(input.password);
        set.passwordChangedAt = new Date();
        set.failedLogins = 0;
        set.lockedUntil = null;
      }
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

// ---------- 본사 관리자 ----------
// 본사 계정은 지점 소속(memberships)이 없어서 위의 사용자 목록에 잡히지 않는다. 따로 관리한다.

export type HqAdminRow = { id: string; loginId: string; name: string; active: boolean; isSelf: boolean; lockedUntil: Date | null };
export type HqAdminInput = { id?: string; loginId: string; name: string; password?: string; active: boolean };

export async function listHqAdmins(ctx: Ctx, db: Db = defaultDb): Promise<HqAdminRow[]> {
  requireRole(ctx, "hq_admin");
  const rows = await db
    .select({ id: users.id, loginId: users.loginId, name: users.name, active: users.active, lockedUntil: users.lockedUntil })
    .from(users)
    .where(eq(users.isHqAdmin, true))
    .orderBy(asc(users.loginId));
  return rows.map((r) => ({ ...r, isSelf: r.id === ctx.userId, lockedUntil: stillLocked(r.lockedUntil) }));
}

/**
 * 본사 관리자를 만들거나 고친다. 본사 관리자만 할 수 있다.
 * 마지막 남은 활성 계정을 끄거나 자기 자신을 끄는 것은 막는다 (아무도 못 들어가는 상태 방지).
 */
export async function upsertHqAdmin(ctx: Ctx, input: HqAdminInput, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, "hq_admin");
  const loginId = input.loginId.trim();
  if (!/^[a-z0-9_.-]{2,30}$/i.test(loginId)) throw new ValidationError("아이디는 영문·숫자 2~30자");
  if (!input.name.trim()) throw new ValidationError("이름을 입력하세요");
  if (input.password !== undefined) {
    const err = validatePassword(input.password);
    if (err) throw new ValidationError(err);
  }

  return db.transaction(async (tx) => {
    const dupConds = [eq(users.loginId, loginId)];
    if (input.id) dupConds.push(ne(users.id, input.id));
    const [dup] = await tx.select({ id: users.id }).from(users).where(and(...dupConds)).limit(1);
    if (dup) throw new ValidationError("이미 사용 중인 아이디입니다");

    if (!input.id) {
      if (!input.password) throw new ValidationError("비밀번호를 입력하세요");
      const [u] = await tx
        .insert(users)
        .values({ loginId, name: input.name.trim(), passwordHash: await hashPassword(input.password), isHqAdmin: true, active: input.active })
        .returning({ id: users.id });
      await writeAudit(tx, ctx, "user", u.id, "create", null, { loginId, role: "hq_admin" });
      return u.id;
    }

    const [before] = await tx.select().from(users).where(and(eq(users.id, input.id), eq(users.isHqAdmin, true))).limit(1);
    if (!before) throw new NotFoundError("본사 관리자를 찾을 수 없습니다");
    if (before.active && !input.active) {
      if (before.id === ctx.userId) throw new ValidationError("자기 계정은 끌 수 없습니다");
      const others = await tx.select({ id: users.id }).from(users).where(and(eq(users.isHqAdmin, true), eq(users.active, true), ne(users.id, input.id)));
      if (others.length === 0) throw new ValidationError("마지막 본사 관리자는 끌 수 없습니다");
    }
    const set: Partial<typeof users.$inferInsert> = { loginId, name: input.name.trim(), active: input.active };
    if (input.password) {
      set.passwordHash = await hashPassword(input.password);
      set.passwordChangedAt = new Date();
      set.failedLogins = 0;
      set.lockedUntil = null;
    }
    await tx.update(users).set(set).where(eq(users.id, input.id));
    await writeAudit(tx, ctx, "user", input.id, "update", { loginId: before.loginId, active: before.active }, { loginId, active: input.active, passwordChanged: Boolean(input.password) });
    return input.id;
  });
}

/** 잠긴 계정을 즉시 풀어 준다 (본사 관리자만) */
export async function unlockUser(ctx: Ctx, userId: string, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, "hq_admin");
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, userId));
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
