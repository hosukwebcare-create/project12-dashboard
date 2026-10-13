import { and, eq } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { memberships, users } from "@/db/schema";
import { ValidationError } from "./errors";

/**
 * 폼에서 받은 사용자 id 가 이 지점 직원인지 확인한다(담당자 지정 등).
 * users·memberships 에는 지점 RLS 가 없어서, 확인하지 않으면 다른 지점 사람을 담당자로 넣고 알림을 보낼 수 있다.
 */
export async function assertBranchStaff(db: Db | Tx, branchId: string, userId: string, label = "담당자"): Promise<void> {
  const [row] = await db
    .select({ id: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.branchId, branchId), eq(memberships.userId, userId), eq(users.active, true)))
    .limit(1);
  if (!row) throw new ValidationError(`${label}는 이 지점 직원 중에서 고르세요`);
}
