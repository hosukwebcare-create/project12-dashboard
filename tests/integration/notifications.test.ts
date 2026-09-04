import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { branches, users } from "@/db/schema";
import type { Ctx } from "@/lib/auth/ctx";
import { listNotifications, markAllRead, notify, unreadCount } from "@/modules/notifications/repo";
import { resetDb } from "./setup";

async function seed() {
  const [b] = await db.insert(branches).values({ code: "B1", name: "지점1" }).returning();
  const [u1] = await db.insert(users).values({ loginId: "u1", name: "하나", passwordHash: "x" }).returning();
  const [u2] = await db.insert(users).values({ loginId: "u2", name: "둘", passwordHash: "x" }).returning();
  const ctx1 = { userId: u1.id, branchId: b.id } as Ctx;
  const ctx2 = { userId: u2.id, branchId: b.id } as Ctx;
  return { b, u1, u2, ctx1, ctx2 };
}

describe("notifications", () => {
  beforeEach(resetDb);

  it("여러 사용자에게 한 번에 알림을 만들고 읽지 않은 수를 센다", async () => {
    const { u1, u2, ctx1, ctx2, b } = await seed();
    await notify(db, [u1.id, u2.id], "issue", { title: "테스트" }, b.id);
    await notify(db, [u1.id], "mention", { logId: "x" }, b.id);
    expect(await unreadCount(ctx1)).toBe(2);
    expect(await unreadCount(ctx2)).toBe(1);
  });

  it("모두 읽음 처리하면 0이 되고 목록에는 남는다", async () => {
    const { u1, ctx1, b } = await seed();
    await notify(db, [u1.id], "issue", { title: "테스트" }, b.id);
    await markAllRead(ctx1);
    expect(await unreadCount(ctx1)).toBe(0);
    const list = await listNotifications(ctx1);
    expect(list).toHaveLength(1);
    expect(list[0].readAt).not.toBeNull();
  });

  it("빈 대상 목록이면 아무것도 만들지 않는다", async () => {
    const { ctx1, b } = await seed();
    await notify(db, [], "issue", {}, b.id);
    expect(await unreadCount(ctx1)).toBe(0);
  });
});
