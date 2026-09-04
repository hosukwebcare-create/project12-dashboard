import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { branches, heroLinks, members, seats } from "@/db/schema";
import { requireRole, STAFF_ROLES, type Ctx } from "@/lib/auth/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";

export function verifyHeroSignature(body: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export type HeroPayload = {
  branchCode: string;
  memberPhone?: string | null;
  memberName?: string | null;
  seatNo?: number | null;
  externalId: string;
  summary: Record<string, unknown>;
  resultUrl: string | null;
  takenAt: string | null;
};

const digits = (s: string) => s.replace(/\D/g, "");

/** HERO 학습진단 웹앱이 설문 완료 시 호출한다. 지점 코드 + (연락처 또는 이름+좌석)으로 회원을 찾는다 */
export async function ingestHeroResult(p: HeroPayload, db: Db = defaultDb): Promise<{ memberId: string; created: boolean }> {
  if (!p.externalId?.trim()) throw new ValidationError("externalId가 필요합니다");
  const [branch] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.code, p.branchCode), eq(branches.active, true))).limit(1);
  if (!branch) throw new NotFoundError("지점 코드를 찾을 수 없습니다");

  const candidates = await db
    .select({ id: members.id, name: members.name, phone: members.phone, seatNo: seats.seatNo })
    .from(members)
    .leftJoin(seats, eq(seats.id, members.seatId))
    .where(and(eq(members.branchId, branch.id)));
  let member = p.memberPhone ? candidates.find((m) => m.phone && digits(m.phone) === digits(p.memberPhone!)) : undefined;
  if (!member && p.memberName) member = candidates.find((m) => m.name === p.memberName!.trim() && (p.seatNo == null || m.seatNo === p.seatNo));
  if (!member) throw new ValidationError("일치하는 회원을 찾을 수 없습니다 (연락처 또는 이름+좌석번호)");

  const takenAt = p.takenAt ? new Date(p.takenAt) : null;
  const [existing] = await db.select({ id: heroLinks.id }).from(heroLinks).where(eq(heroLinks.externalId, p.externalId)).limit(1);
  if (existing) {
    await db.update(heroLinks).set({ memberId: member.id, branchId: branch.id, summary: p.summary ?? {}, resultUrl: p.resultUrl, takenAt }).where(eq(heroLinks.id, existing.id));
    return { memberId: member.id, created: false };
  }
  await db.insert(heroLinks).values({ branchId: branch.id, memberId: member.id, externalId: p.externalId, summary: p.summary ?? {}, resultUrl: p.resultUrl, takenAt });
  return { memberId: member.id, created: true };
}

export async function listHeroLinks(ctx: Ctx, memberId: string, db: Db = defaultDb) {
  requireRole(ctx, ...STAFF_ROLES);
  return db
    .select()
    .from(heroLinks)
    .where(and(eq(heroLinks.memberId, memberId), eq(heroLinks.branchId, ctx.branchId)))
    .orderBy(desc(heroLinks.takenAt), desc(heroLinks.createdAt));
}
