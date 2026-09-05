import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { listPinUsers, switchByPin } from "@/modules/auth/pin";
import { LOCK_MINUTES, MAX_FAILED_LOGINS } from "@/modules/auth/login";
import { setUserPin } from "@/modules/settings/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

describe("조교 PIN 전환", () => {
  beforeEach(resetDb);

  it("PIN이 설정된 같은 지점 조교 목록을 주고, 맞는 PIN이면 그 사용자로 전환한다", async () => {
    const t = await seedTwoBranches();
    await setUserPin(t.mgrCtx1, t.users.asst1.id, "1234");
    const list = await listPinUsers(t.asstCtx1);
    expect(list.map((u) => u.name)).toEqual(["조교1"]);
    const target = await switchByPin(t.asstCtx1, t.users.asst1.id, "1234");
    expect(target).toEqual({ userId: t.users.asst1.id, branchId: t.b1.id });
  });

  it("틀린 PIN, PIN 없는 사용자, 타 지점 사용자는 거부한다", async () => {
    const t = await seedTwoBranches();
    await setUserPin(t.mgrCtx1, t.users.asst1.id, "1234");
    await expect(switchByPin(t.asstCtx1, t.users.asst1.id, "0000")).rejects.toThrow(ValidationError);
    await expect(switchByPin(t.asstCtx1, t.users.mentor1.id, "1234")).rejects.toThrow(ValidationError);
    await expect(switchByPin(t.mgrCtx2, t.users.asst1.id, "1234")).rejects.toThrow(ForbiddenError);
  });

  it("지점장·멘토 계정으로는 전환할 수 없다 (조교 전용)", async () => {
    const t = await seedTwoBranches();
    await setUserPin(t.mgrCtx1, t.users.mgr1.id, "9999");
    expect((await listPinUsers(t.asstCtx1)).map((u) => u.name)).toEqual([]);
    await expect(switchByPin(t.asstCtx1, t.users.mgr1.id, "9999")).rejects.toThrow(ValidationError);
  });

  it("PIN 5회 실패하면 10분간 잠기고 맞는 PIN 도 거부하며, 잠금이 풀린 뒤 성공하면 카운터가 초기화된다", async () => {
    const t = await seedTwoBranches();
    await setUserPin(t.mgrCtx1, t.users.asst1.id, "1234");
    const now = new Date("2026-09-06T10:00:00+09:00");
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      await expect(switchByPin(t.asstCtx1, t.users.asst1.id, "0000", undefined, now)).rejects.toThrow(new RegExp(`${MAX_FAILED_LOGINS - i}회 남음`));
    }
    await expect(switchByPin(t.asstCtx1, t.users.asst1.id, "0000", undefined, now)).rejects.toThrow(/잠겼습니다/);
    await expect(switchByPin(t.asstCtx1, t.users.asst1.id, "1234", undefined, now)).rejects.toThrow(/잠겼습니다/);
    const later = new Date(now.getTime() + (LOCK_MINUTES + 1) * 60_000);
    await expect(switchByPin(t.asstCtx1, t.users.asst1.id, "1234", undefined, later)).resolves.toMatchObject({ userId: t.users.asst1.id });
    await expect(switchByPin(t.asstCtx1, t.users.asst1.id, "0000", undefined, later)).rejects.toThrow(new RegExp(`${MAX_FAILED_LOGINS - 1}회 남음`));
  });
});
