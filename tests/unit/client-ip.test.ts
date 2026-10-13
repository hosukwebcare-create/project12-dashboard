import { afterEach, describe, expect, it } from "vitest";
import { clientIp, userAgentOf } from "@/lib/client-ip";

const h = (xff?: string, real?: string) => new Headers({ ...(xff !== undefined ? { "x-forwarded-for": xff } : {}), ...(real ? { "x-real-ip": real } : {}) });

describe("요청자 IP 판정", () => {
  afterEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS;
  });

  it("프록시가 덧붙인 오른쪽 공인 IP 를 쓴다 — 맨 앞에 적어 보낸 값으로는 바꿀 수 없다", () => {
    expect(clientIp(h("1.1.1.1, 203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIp(h("9.9.9.9, 8.8.8.8, 203.0.113.9"))).toBe("203.0.113.9");
  });

  it("내부 프록시의 사설 주소는 건너뛴다", () => {
    expect(clientIp(h("203.0.113.9, 10.0.0.1"))).toBe("203.0.113.9");
    expect(clientIp(h("1.1.1.1, 203.0.113.9, 100.64.0.3, 127.0.0.1"))).toBe("203.0.113.9");
  });

  it("프록시 단계가 둘이면 TRUSTED_PROXY_HOPS=2 로 하나 더 안쪽을 본다", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(clientIp(h("1.1.1.1, 203.0.113.9, 198.51.100.7"))).toBe("203.0.113.9");
    expect(clientIp(h("203.0.113.9"))).toBe("203.0.113.9");
  });

  it("포트·대괄호·대소문자를 정리하고, IP 가 아닌 값은 버린다", () => {
    expect(clientIp(h("evil, 203.0.113.9:4431"))).toBe("203.0.113.9");
    expect(clientIp(h("[2001:DB8::1]:443"))).toBe("2001:db8::1");
    expect(clientIp(h("not-an-ip"))).toBe("unknown");
  });

  it("사설 주소만 있으면 가장 오른쪽, 헤더가 없으면 X-Real-IP, 그것도 없으면 unknown", () => {
    expect(clientIp(h("10.0.0.5, 10.0.0.1"))).toBe("10.0.0.1");
    expect(clientIp(h(undefined, "203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("브라우저 정보는 300자로 자른다", () => {
    expect(userAgentOf(new Headers({ "user-agent": "x".repeat(500) }))?.length).toBe(300);
    expect(userAgentOf(new Headers())).toBeNull();
  });
});
