import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "@/lib/auth/session";

describe("세션 토큰", () => {
  it("서명 후 검증하면 같은 내용이 나온다", async () => {
    const token = await signSession({ userId: "u-1", branchId: "b-1", sessionId: "s-1" });
    const s = await verifySession(token);
    expect(s).toMatchObject({ userId: "u-1", branchId: "b-1", sessionId: "s-1" });
    expect(s!.issuedAt).toBeGreaterThan(0);
  });
  it("지점이 없는 세션도 표현한다", async () => {
    const token = await signSession({ userId: "u-1", branchId: null, sessionId: "s-1" });
    expect(await verifySession(token)).toMatchObject({ userId: "u-1", branchId: null });
  });
  it("변조된 토큰은 null", async () => {
    const token = await signSession({ userId: "u-1", branchId: "b-1", sessionId: "s-1" });
    const tampered = token.slice(0, -3) + "abc";
    expect(await verifySession(tampered)).toBeNull();
  });
  it("만료된 토큰은 null", async () => {
    const token = await signSession({ userId: "u-1", branchId: "b-1", sessionId: "s-1" }, { ttlSeconds: -10 });
    expect(await verifySession(token)).toBeNull();
  });
  it("빈 값은 null", async () => {
    expect(await verifySession(undefined)).toBeNull();
  });
  it("세션 번호가 없는 예전 토큰은 서명이 맞아도 null — 서버에서 끊을 수 없는 토큰이다", async () => {
    const legacy = await new SignJWT({ b: "b-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u-1")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
    expect(await verifySession(legacy)).toBeNull();
  });
});
