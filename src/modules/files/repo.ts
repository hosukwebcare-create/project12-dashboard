import { randomUUID } from "node:crypto";
import { and, desc, eq, max } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { accessLogs, memberFiles, members, users, type MemberFileKind } from "@/db/schema";
import { requireRole, STAFF_ROLES, type Ctx } from "@/lib/auth/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { sniffMime } from "@/lib/file-type";
import { getStorage, type FileStorage } from "@/lib/storage";

export const FILE_KIND_LABEL: Record<MemberFileKind, string> = { hero_result: "HERO 진단 결과", ai_report: "AI 컨설팅 리포트", other: "기타" };
const MAX_SIZE = 20 * 1024 * 1024;

export type SaveFileInput = { memberId: string; kind: MemberFileKind; title: string; fileName: string; mimeType: string; data: Buffer };
export type MemberFileRow = typeof memberFiles.$inferSelect & { uploaderName: string | null };

export async function saveMemberFile(ctx: Ctx, input: SaveFileInput, storage: FileStorage = getStorage(), db: Db = defaultDb): Promise<string> {
  requireRole(ctx, ...STAFF_ROLES);
  if (input.data.length > MAX_SIZE) throw new ValidationError("파일은 20MB 이하여야 합니다");
  if (input.data.length === 0) throw new ValidationError("빈 파일입니다");
  // 브라우저가 보낸 MIME 은 무시하고 내용의 시그니처로 형식을 정한다
  const mimeType = sniffMime(input.data);
  if (!mimeType) throw new ValidationError("PDF, PNG, JPEG 파일만 올릴 수 있습니다 (파일 내용이 형식과 다릅니다)");
  const title = input.title.trim() || input.fileName;
  const [m] = await db.select({ id: members.id }).from(members).where(and(eq(members.id, input.memberId), eq(members.branchId, ctx.branchId))).limit(1);
  if (!m) throw new NotFoundError("회원을 찾을 수 없습니다");
  const [{ v }] = await db
    .select({ v: max(memberFiles.version) })
    .from(memberFiles)
    .where(and(eq(memberFiles.memberId, input.memberId), eq(memberFiles.kind, input.kind), eq(memberFiles.title, title)));
  const version = (v ?? 0) + 1;
  const safeName = input.fileName.replace(/[^\w.\-가-힣]/g, "_").slice(0, 100);
  const storageKey = `${ctx.branchId}/${input.memberId}/${randomUUID()}-${safeName}`;
  await storage.put(storageKey, input.data, mimeType);
  const [row] = await db
    .insert(memberFiles)
    .values({ branchId: ctx.branchId, memberId: input.memberId, kind: input.kind, title, fileName: input.fileName, mimeType, size: input.data.length, storageKey, version, uploadedBy: ctx.userId })
    .returning({ id: memberFiles.id });
  return row.id;
}

export async function listMemberFiles(ctx: Ctx, memberId: string, db: Db = defaultDb): Promise<MemberFileRow[]> {
  requireRole(ctx, ...STAFF_ROLES);
  const rows = await db
    .select({ f: memberFiles, uploaderName: users.name })
    .from(memberFiles)
    .leftJoin(users, eq(users.id, memberFiles.uploadedBy))
    .where(and(eq(memberFiles.memberId, memberId), eq(memberFiles.branchId, ctx.branchId)))
    .orderBy(desc(memberFiles.createdAt));
  return rows.map((r) => ({ ...r.f, uploaderName: r.uploaderName }));
}

export async function getMemberFile(ctx: Ctx, id: string, storage: FileStorage = getStorage(), db: Db = defaultDb): Promise<{ meta: typeof memberFiles.$inferSelect; data: Buffer }> {
  requireRole(ctx, ...STAFF_ROLES);
  const [meta] = await db.select().from(memberFiles).where(and(eq(memberFiles.id, id), eq(memberFiles.branchId, ctx.branchId))).limit(1);
  if (!meta) throw new NotFoundError("파일을 찾을 수 없습니다");
  await db.insert(accessLogs).values({ actorId: ctx.userId, branchId: ctx.branchId, entity: "member_file", entityId: id });
  const data = await storage.get(meta.storageKey);
  return { meta, data };
}
