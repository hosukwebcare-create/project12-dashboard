import { beforeEach, describe, expect, it } from "vitest";
import { buildCtx } from "@/lib/auth/ctx";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { createBranch, listBranches, setBranchActive, updateBranchInfo } from "@/modules/branches/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

describe("지점 관리 (본사)", () => {
  beforeEach(resetDb);

  it("본사 관리자만 지점을 만들고, 첫 지점장 계정을 함께 만들 수 있다", async () => {
    const t = await seedTwoBranches();
    await expect(createBranch(t.mgrCtx1, { code: "B3", name: "지점3" })).rejects.toThrow(ForbiddenError);
    const r = await createBranch(t.hqCtx1, { code: "b3", name: "지점3", seatCount: 30, manager: { loginId: "mgr3", name: "지점장3", password: "strongpass12" } });
    expect(r.branchId).toBeTruthy();
    const list = await listBranches(t.hqCtx1);
    expect(list.map((b) => [b.code, b.name, b.seatCount, b.managerNames])).toEqual([
      ["B1", "지점1", 5, ["지점장1"]],
      ["B2", "지점2", 5, ["지점장2"]],
      ["B3", "지점3", 30, ["지점장3"]],
    ]);
    const ctx = await buildCtx(r.managerId!, null);
    expect(ctx?.role).toBe("branch_manager");
    expect(ctx?.branchName).toBe("지점3");
    expect(ctx?.settings.roundsPerDay).toBe(12);
  });

  it("코드 중복·형식 오류·비밀번호 정책을 검증한다", async () => {
    const t = await seedTwoBranches();
    await expect(createBranch(t.hqCtx1, { code: "B1", name: "중복" })).rejects.toThrow(/코드/);
    await expect(createBranch(t.hqCtx1, { code: "지점", name: "x" })).rejects.toThrow(ValidationError);
    await expect(createBranch(t.hqCtx1, { code: "B9", name: "x", manager: { loginId: "mgr9", name: "x", password: "short" } })).rejects.toThrow(/10자/);
  });

  it("지점을 비활성화하면 목록·전환에서 빠지고 소속 사용자는 로그인 컨텍스트를 잃는다", async () => {
    const t = await seedTwoBranches();
    await setBranchActive(t.hqCtx1, t.b2.id, false);
    expect((await listBranches(t.hqCtx1)).find((b) => b.id === t.b2.id)?.active).toBe(false);
    expect(await buildCtx(t.users.mgr2.id, null)).toBeNull();
    expect((await buildCtx(t.users.hq.id, null))?.memberships.map((m) => m.branchName)).toEqual(["지점1"]);
    await expect(setBranchActive(t.hqCtx1, t.b1.id, false)).rejects.toThrow(/현재 지점/);
  });

  it("지점 이름·코드를 수정한다", async () => {
    const t = await seedTwoBranches();
    await updateBranchInfo(t.hqCtx1, t.b2.id, { code: "SW1", name: "수원1" });
    expect((await listBranches(t.hqCtx1)).map((b) => b.code)).toEqual(["B1", "SW1"]);
    await expect(updateBranchInfo(t.mgrCtx2, t.b2.id, { code: "X", name: "x" })).rejects.toThrow(ForbiddenError);
  });
});
