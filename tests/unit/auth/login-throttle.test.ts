import { beforeEach, describe, expect, it } from "vitest";
import { checkLoginIp, clearLoginFailures, clientIp, LOGIN_THROTTLE, recordLoginFailure, resetLoginThrottle } from "@/lib/auth/login-throttle";

describe("IP 기준 로그인 제한", () => {
  beforeEach(resetLoginThrottle);

  it("프록시를 거친 요청은 맨 앞 주소를 클라이언트로 본다", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("한도 안에서는 계속 시도할 수 있다", () => {
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES - 1; i++) recordLoginFailure("1.2.3.4");
    expect(checkLoginIp("1.2.3.4")).toEqual({ ok: true });
  });

  it("한도를 넘기면 창 길이만큼 막는다", () => {
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES; i++) recordLoginFailure("1.2.3.4");
    const gate = checkLoginIp("1.2.3.4");
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.retryAfterSec).toBeGreaterThan(0);
    expect(checkLoginIp("5.6.7.8")).toEqual({ ok: true }); // 다른 IP 는 영향 없다
  });

  it("창을 벗어난 실패는 세지 않는다", () => {
    const long_ago = Date.now() - LOGIN_THROTTLE.WINDOW_MS - 1000;
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES - 1; i++) recordLoginFailure("1.2.3.4", long_ago);
    recordLoginFailure("1.2.3.4");
    expect(checkLoginIp("1.2.3.4")).toEqual({ ok: true });
  });

  it("막힌 뒤에도 창이 지나면 다시 열린다", () => {
    const t0 = Date.now();
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES; i++) recordLoginFailure("1.2.3.4", t0);
    expect(checkLoginIp("1.2.3.4", t0).ok).toBe(false);
    expect(checkLoginIp("1.2.3.4", t0 + LOGIN_THROTTLE.WINDOW_MS + 1).ok).toBe(true);
  });

  it("로그인에 성공하면 그 IP 의 기록을 지운다", () => {
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES; i++) recordLoginFailure("1.2.3.4");
    clearLoginFailures("1.2.3.4");
    expect(checkLoginIp("1.2.3.4")).toEqual({ ok: true });
  });
});
