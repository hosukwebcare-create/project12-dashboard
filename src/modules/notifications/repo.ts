import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db as defaultDb, type Db, type Tx } from "@/db/client";
import { notifications } from "@/db/schema";
import type { Ctx } from "@/lib/auth/ctx";

export type NotificationRow = typeof notifications.$inferSelect;

export async function notify(
  tx: Db | Tx,
  userIds: string[],
  type: string,
  payload: Record<string, unknown>,
  branchId: string | null,
): Promise<void> {
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return;
  await tx.insert(notifications).values(unique.map((userId) => ({ userId, branchId, type, payload })));
}

export async function unreadCount(ctx: Pick<Ctx, "userId">, db: Db = defaultDb): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)));
  return Number(row?.n ?? 0);
}

export async function listNotifications(ctx: Pick<Ctx, "userId">, db: Db = defaultDb): Promise<NotificationRow[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, ctx.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(100);
}

export async function markAllRead(ctx: Pick<Ctx, "userId">, db: Db = defaultDb): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)));
}
