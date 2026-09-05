import { and, eq, isNull, lte } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { auditLogs, memberFiles, memberGuardians, members } from "@/db/schema";
import { addDays, toDateKey } from "@/lib/rules/week";
import { getStorage, type FileStorage } from "@/lib/storage";

export const DEFAULT_RETENTION_DAYS = 365;

/**
 * 퇴원 후 보관기간이 지난 회원의 개인정보를 익명화한다.
 * - 이름은 "탈퇴회원-xxxx", 연락처·생년월일·주소·목표·메모·특이사항·커스텀 값은 삭제
 * - 학부모 정보와 회원 파일(저장소 객체 포함)은 삭제
 * - 상담·체크·이슈 기록은 통계용으로 남되 익명화된 회원 id 에 연결된다
 */
export async function anonymizeWithdrawnMembers(
  opts: { retentionDays?: number; now?: Date } = {},
  storage: FileStorage = getStorage(),
  db: Db = defaultDb,
): Promise<{ anonymized: number; filesDeleted: number }> {
  const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const now = opts.now ?? new Date();
  const cutoff = toDateKey(addDays(toDateKey(now), -retentionDays));
  const targets = await db
    .select({ id: members.id, branchId: members.branchId, name: members.name })
    .from(members)
    .where(and(eq(members.status, "withdrawn"), lte(members.withdrawnAt, cutoff), isNull(members.anonymizedAt)));

  let filesDeleted = 0;
  for (const m of targets) {
    const files = await db.select().from(memberFiles).where(eq(memberFiles.memberId, m.id));
    for (const f of files) {
      await storage.delete(f.storageKey);
      filesDeleted++;
    }
    await db.transaction(async (tx) => {
      await tx.delete(memberFiles).where(eq(memberFiles.memberId, m.id));
      await tx.delete(memberGuardians).where(eq(memberGuardians.memberId, m.id));
      await tx
        .update(members)
        .set({
          name: `탈퇴회원-${m.id.slice(0, 4)}`,
          phone: null,
          birthDate: null,
          gender: null,
          address: null,
          target: null,
          memo: null,
          fieldNote: null,
          school: null,
          custom: {},
          anonymizedAt: now,
        })
        .where(eq(members.id, m.id));
      await tx.insert(auditLogs).values({ actorId: null, branchId: m.branchId, entity: "member", entityId: m.id, action: "update", before: { anonymized: false }, after: { anonymized: true, retentionDays, cutoff } });
    });
  }
  return { anonymized: targets.length, filesDeleted };
}
