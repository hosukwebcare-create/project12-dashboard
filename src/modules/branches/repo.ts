import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { branches, memberships, seats, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { hashPassword, validatePassword } from "@/lib/auth/password";
import { requireRole, type Ctx } from "@/lib/auth/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";

export type BranchListRow = { id: string; code: string; name: string; ownerName: string | null; active: boolean; seatCount: number; memberCount: number; managerNames: string[]; roundsPerDay: number };
export type CreateBranchInput = { code: string; name: string; ownerName?: string | null; seatCount?: number; roundsPerDay?: number; manager?: { loginId: string; name: string; password: string } };

function normCode(code: string) {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,10}$/.test(c)) throw new ValidationError("지점 코드는 영문·숫자 2~10자 (예: DT2)");
  return c;
}

export async function listBranches(ctx: Ctx, db: Db = defaultDb): Promise<BranchListRow[]> {
  requireRole(ctx, "hq_admin");
  const rows = await db.select().from(branches).orderBy(asc(branches.code));
  const seatCounts = await db.select({ branchId: seats.branchId, n: count() }).from(seats).groupBy(seats.branchId);
  const memberCounts = await db.execute<{ branch_id: string; n: string }>(sql`select branch_id, count(*)::text as n from members where status = 'enrolled' group by branch_id`);
  const managers = await db
    .select({ branchId: memberships.branchId, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.role, "branch_manager"), eq(users.active, true)))
    .orderBy(asc(users.name));
  const seatBy = new Map(seatCounts.map((s) => [s.branchId, Number(s.n)]));
  const memberBy = new Map(memberCounts.map((m) => [m.branch_id, Number(m.n)]));
  const mgrBy = new Map<string, string[]>();
  for (const m of managers) mgrBy.set(m.branchId, [...(mgrBy.get(m.branchId) ?? []), m.name]);
  return rows.map((b) => ({ id: b.id, code: b.code, name: b.name, ownerName: b.ownerName, active: b.active, seatCount: seatBy.get(b.id) ?? 0, memberCount: memberBy.get(b.id) ?? 0, managerNames: mgrBy.get(b.id) ?? [], roundsPerDay: b.settings.roundsPerDay }));
}

export async function createBranch(ctx: Ctx, input: CreateBranchInput, db: Db = defaultDb): Promise<{ branchId: string; managerId: string | null }> {
  requireRole(ctx, "hq_admin");
  const code = normCode(input.code);
  const name = input.name.trim();
  if (!name) throw new ValidationError("지점 이름을 입력하세요");
  const ownerName = input.ownerName?.trim() || null;
  const seatCount = input.seatCount ?? 0;
  if (!Number.isInteger(seatCount) || seatCount < 0 || seatCount > 500) throw new ValidationError("좌석 수는 0~500");
  const roundsPerDay = input.roundsPerDay ?? 12;
  if (input.manager) {
    if (!/^[a-z0-9_.-]{3,30}$/i.test(input.manager.loginId.trim())) throw new ValidationError("지점장 아이디는 영문·숫자 3~30자");
    const err = validatePassword(input.manager.password);
    if (err) throw new ValidationError(err);
  }
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.code, code)).limit(1);
    if (dup) throw new ValidationError(`지점 코드 ${code}가 이미 있습니다`);
    const [b] = await tx.insert(branches).values({ code, name, ownerName, settings: { roundsPerDay, maskNames: false } }).returning({ id: branches.id });
    if (seatCount > 0) {
      await tx.insert(seats).values(Array.from({ length: seatCount }, (_, i) => ({ branchId: b.id, seatNo: i + 1, zone: "A", sort: i + 1 })));
    }
    let managerId: string | null = null;
    if (input.manager) {
      const loginId = input.manager.loginId.trim();
      const [dupUser] = await tx.select({ id: users.id }).from(users).where(eq(users.loginId, loginId)).limit(1);
      if (dupUser) throw new ValidationError("이미 사용 중인 아이디입니다");
      const [u] = await tx.insert(users).values({ loginId, name: input.manager.name.trim(), passwordHash: await hashPassword(input.manager.password) }).returning({ id: users.id });
      await tx.insert(memberships).values({ userId: u.id, branchId: b.id, role: "branch_manager" });
      managerId = u.id;
    }
    await writeAudit(tx, { userId: ctx.userId, branchId: b.id }, "branch", b.id, "create", null, { code, name, ownerName, seatCount, managerId });
    return { branchId: b.id, managerId };
  });
}

export async function updateBranchInfo(ctx: Ctx, branchId: string, input: { code: string; name: string; ownerName?: string | null }, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, "hq_admin");
  const code = normCode(input.code);
  const name = input.name.trim();
  if (!name) throw new ValidationError("지점 이름을 입력하세요");
  const ownerName = input.ownerName === undefined ? undefined : input.ownerName?.trim() || null;
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(branches).where(eq(branches.id, branchId)).limit(1);
    if (!b) throw new NotFoundError("지점을 찾을 수 없습니다");
    const [dup] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.code, code), ne(branches.id, branchId))).limit(1);
    if (dup) throw new ValidationError(`지점 코드 ${code}가 이미 있습니다`);
    await tx.update(branches).set({ code, name, ...(ownerName === undefined ? {} : { ownerName }) }).where(eq(branches.id, branchId));
    await writeAudit(tx, { userId: ctx.userId, branchId }, "branch", branchId, "update", { code: b.code, name: b.name, ownerName: b.ownerName }, { code, name, ownerName: ownerName === undefined ? b.ownerName : ownerName });
  });
}

export async function setBranchActive(ctx: Ctx, branchId: string, active: boolean, db: Db = defaultDb): Promise<void> {
  requireRole(ctx, "hq_admin");
  if (!active && branchId === ctx.branchId) throw new ValidationError("현재 지점은 비활성화할 수 없습니다. 다른 지점으로 전환한 뒤 시도하세요");
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(branches).where(eq(branches.id, branchId)).limit(1);
    if (!b) throw new NotFoundError("지점을 찾을 수 없습니다");
    await tx.update(branches).set({ active }).where(eq(branches.id, branchId));
    await writeAudit(tx, { userId: ctx.userId, branchId }, "branch", branchId, "status", { active: b.active }, { active });
  });
}
