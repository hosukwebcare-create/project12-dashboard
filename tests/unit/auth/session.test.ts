import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "@/lib/auth/session";

describe("세션 토큰", () => {
  it("서명 후 검증하면 같은 내용이 나온다", async () => {
    const token = await signSession({ userId: "u-1", branchId: "b-1" });
    const s = await verifySession(token);
    expect(s).toEqual({ userId: "u-1", branchId: "b-1" });
  });
  it("지점이 없는 세션도 표현한다", async () => {
    const token = await signSession({ userId: "u-1", branchId: null });
    expect(await verifySession(token)).toEqual({ userId: "u-1", branchId: null });
  });
  it("변조된 토큰은 null", async () => {
    const token = await signSession({ userId: "u-1", branchId: "b-1" });
    const tampered = token.slice(0, -3) + "abc";
    expect(await verifySession(tampered)).toBeNull();
  });
  it("만료된 토큰은 null", async () => {
    const token = await signSession({ userId: "u-1", branchId: "b-1" }, { ttlSeconds: -10 });
    expect(await verifySession(token)).toBeNull();
  });
  it("빈 값은 null", async () => {
    expect(await verifySession(undefined)).toBeNull();
  });
});
