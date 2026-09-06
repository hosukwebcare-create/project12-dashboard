import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { boardItems, branches, memberships, penaltyRules, seats, users } from "@/db/schema";
import { buildCtx } from "@/lib/auth/ctx";
import { verifyPassword } from "@/lib/auth/password";
import { ValidationError } from "@/lib/errors";
import { ensureDefaults, needsSetup, runSetup } from "@/modules/setup/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

describe("처음 설정", () => {
  beforeEach(resetDb);

  it("빈 DB 에서 본사 계정·기본 규칙·첫 지점·지점장을 만들고, 그 뒤로는 닫힌다", async () => {
    expect(await needsSetup()).toBe(true);
    const r = await runSetup({
      hqLoginId: "hq",
      hqName: "본사",
      hqPassword: "strongpass12",
      branch: { code: "dt2", name: "동탄2", seatCount: 77, roundsPerDay: 11, managerLoginId: "dt2manager", managerName: "지점장", managerPassword: "managerpw34" },
    });
    expect(await needsSetup()).toBe(false);
    const [hq] = await db.select().from(users).where(eq(users.loginId, "hq"));
    expect(hq.isHqAdmin).toBe(true);
    expect(await verifyPassword("strongpass12", hq.passwordHash)).toBe(true);
    expect((await db.select().from(penaltyRules)).length).toBe(6);
    expect((await db.select().from(boardItems)).length).toBe(5);
    const [b] = await db.select().from(branches);
    expect(b).toMatchObject({ code: "DT2", name: "동탄2", settings: { roundsPerDay: 11 } });
    expect((await db.select().from(seats).where(eq(seats.branchId, b.id))).length).toBe(77);
    const [ms] = await db.select().from(memberships);
    expect(ms.role).toBe("branch_manager");
    const ctx = await buildCtx(ms.userId, null);
    expect(ctx?.branchName).toBe("동탄2");
    expect(r.branchId).toBe(b.id);
    await expect(runSetup({ hqLoginId: "again", hqName: "x", hqPassword: "strongpass12" })).rejects.toThrow(/이미 설정/);
  });

  it("검증: 약한 비밀번호, 잘못된 코드, 같은 아이디는 거부하고 아무것도 만들지 않는다", async () => {
    await expect(runSetup({ hqLoginId: "hq", hqName: "본사", hqPassword: "short" })).rejects.toThrow(ValidationError);
    await expect(runSetup({ hqLoginId: "hq", hqName: "본사", hqPassword: "strongpass12", branch: { code: "동탄", name: "x", seatCount: 1, roundsPerDay: 12 } })).rejects.toThrow(/지점 코드/);
    await expect(runSetup({ hqLoginId: "hq", hqName: "본사", hqPassword: "strongpass12", branch: { code: "A1", name: "x", seatCount: 1, roundsPerDay: 12, managerLoginId: "hq", managerPassword: "strongpass12" } })).rejects.toThrow(/달라야/);
    expect(await needsSetup()).toBe(true);
    expect((await db.select().from(users)).length).toBe(0);
  });

  it("기본값 보장은 이미 있는 규칙을 건드리지 않는다", async () => {
    await seedTwoBranches();
    const before = (await db.select().from(penaltyRules)).length;
    const r = await ensureDefaults();
    expect(r.rules).toBe(false);
    expect((await db.select().from(penaltyRules)).length).toBe(before);
    expect(await needsSetup()).toBe(false);
  });
});
