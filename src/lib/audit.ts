import type { Db, Tx } from "@/db/client";
import { auditLogs } from "@/db/schema";
import type { Ctx } from "@/lib/auth/ctx";

export type AuditAction = "create" | "update" | "status" | "seat" | "delete";

export async function writeAudit(
  tx: Db | Tx,
  ctx: Pick<Ctx, "userId" | "branchId">,
  entity: string,
  entityId: string,
  action: AuditAction,
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorId: ctx.userId,
    branchId: ctx.branchId,
    entity,
    entityId,
    action,
    before: before ?? null,
    after: after ?? null,
  });
}
