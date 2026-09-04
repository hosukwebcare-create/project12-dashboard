import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { branches, checks, members, seats, type Grade } from "@/db/schema";
import { MANAGER_ROLES, requireRole, type Ctx } from "@/lib/auth/ctx";
import { NotFoundError } from "@/lib/errors";
import { maskName } from "@/lib/rules/masking";
import { sumPoints } from "@/lib/rules/penalty";
import { toDateKey, weekDays, weekStart } from "@/lib/rules/week";
import { penaltyRulesFor } from "@/modules/rounding/repo";
import { boardItemsFor } from "@/modules/settings/repo";

export type BoardData = {
  branchName: string;
  weekStart: string;
  days: string[];
  rules: { name: string; points: number }[];
  items: { key: string; label: string; kind: "daily" | "round" }[];
  roundsPerDay: number;
  seats: { seatNo: number; name: string; weeklyPoints: number }[];
  /** `${seatNo}|${date}|${itemKey}|${roundNo}` */
  cells: Record<string, { grade: Grade; points: number }>;
  generatedAt: string;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueBoardToken(ctx: Ctx, db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...MANAGER_ROLES);
  const token = randomBytes(16).toString("hex");
  await db.update(branches).set({ boardTokenHash: hashToken(token) }).where(eq(branches.id, ctx.branchId));
  return token;
}

export async function verifyBoardToken(branchId: string, token: string | null | undefined, db: Db = defaultDb): Promise<boolean> {
  if (!token) return false;
  const [b] = await db.select({ hash: branches.boardTokenHash }).from(branches).where(and(eq(branches.id, branchId), eq(branches.active, true))).limit(1);
  return Boolean(b?.hash) && b!.hash === hashToken(token);
}

export async function boardData(branchId: string, weekStartInput: string, db: Db = defaultDb): Promise<BoardData> {
  const [branch] = await db.select().from(branches).where(and(eq(branches.id, branchId), eq(branches.active, true))).limit(1);
  if (!branch) throw new NotFoundError("지점을 찾을 수 없습니다");
  const ws = toDateKey(weekStart(weekStartInput));
  const days = weekDays(ws).map(toDateKey);
  const scope = { branchId };
  const [items, rules, memberRows] = await Promise.all([
    boardItemsFor(scope, db),
    penaltyRulesFor(scope, db),
    db
      .select({ id: members.id, name: members.name, seatNo: seats.seatNo })
      .from(members)
      .innerJoin(seats, eq(seats.id, members.seatId))
      .where(and(eq(members.branchId, branchId), eq(members.status, "enrolled"), isNotNull(members.seatId)))
      .orderBy(asc(seats.sort), asc(seats.seatNo)),
  ]);
  const seatByMember = new Map(memberRows.map((m) => [m.id, m.seatNo]));
  const checkRows = memberRows.length
    ? await db
        .select({ memberId: checks.memberId, date: checks.date, itemKey: checks.itemKey, roundNo: checks.roundNo, grade: checks.grade, points: checks.points })
        .from(checks)
        .where(and(eq(checks.branchId, branchId), inArray(checks.date, days), inArray(checks.memberId, memberRows.map((m) => m.id))))
    : [];
  const cells: BoardData["cells"] = {};
  const pointsByMember = new Map<string, { grade: Grade; points: number }[]>();
  for (const c of checkRows) {
    const seatNo = seatByMember.get(c.memberId);
    if (seatNo === undefined) continue;
    cells[`${seatNo}|${c.date}|${c.itemKey}|${c.roundNo}`] = { grade: c.grade, points: c.points };
    pointsByMember.set(c.memberId, [...(pointsByMember.get(c.memberId) ?? []), { grade: c.grade, points: c.points }]);
  }
  return {
    branchName: branch.name,
    weekStart: ws,
    days,
    rules: rules.map((r) => ({ name: r.name, points: r.points })),
    items: items.map((i) => ({ key: i.key, label: i.label, kind: i.kind })),
    roundsPerDay: branch.settings.roundsPerDay,
    seats: memberRows.map((m) => ({
      seatNo: m.seatNo,
      name: branch.settings.maskNames ? maskName(m.name) : m.name,
      weeklyPoints: sumPoints(pointsByMember.get(m.id) ?? []),
    })),
    cells,
    generatedAt: new Date().toISOString(),
  };
}
