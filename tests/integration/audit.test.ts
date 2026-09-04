import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditLogs, branches, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import type { Ctx } from "@/lib/auth/ctx";
import { resetDb } from "./setup";

describe("writeAudit", () => {
  beforeEach(resetDb);

  it("행위자·지점·before/after 를 남긴다", async () => {
    const [b] = await db.insert(branches).values({ code: "B1", name: "지점1" }).returning();
    const [u] = await db.insert(users).values({ loginId: "u", name: "사용자", passwordHash: "x" }).returning();
    const ctx = { userId: u.id, branchId: b.id } as Ctx;
    const entityId = "11111111-1111-1111-1111-111111111111";

    await writeAudit(db, ctx, "member", entityId, "update", { name: "전" }, { name: "후" });

    const rows = await db.select().from(auditLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: u.id,
      branchId: b.id,
      entity: "member",
      entityId,
      action: "update",
      before: { name: "전" },
      after: { name: "후" },
    });
  });
});
