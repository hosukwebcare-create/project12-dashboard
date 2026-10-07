import { afterEach, describe, expect, it } from "vitest";
import { assertResolvesSafe, assertSafeWebhookUrl, ipKind } from "@/lib/net";
import { sniffMime } from "@/lib/file-type";

describe("웹훅 SSRF 차단", () => {
  afterEach(() => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE;
  });

  it("IP 종류를 판정한다", () => {
    expect(ipKind("127.0.0.1")).toBe("loopback");
    expect(ipKind("169.254.169.254")).toBe("link_local");
    expect(ipKind("10.1.2.3")).toBe("private");
    expect(ipKind("172.20.0.1")).toBe("private");
    expect(ipKind("192.168.0.9")).toBe("private");
    expect(ipKind("100.100.1.1")).toBe("private");
    expect(ipKind("0.0.0.0")).toBe("special");
    expect(ipKind("8.8.8.8")).toBe("public");
    expect(ipKind("::1")).toBe("loopback");
    expect(ipKind("fe80::1")).toBe("link_local");
    expect(ipKind("fd00::1")).toBe("private");
    expect(ipKind("::ffff:127.0.0.1")).toBe("loopback");
    expect(ipKind("2606:4700::1111")).toBe("public");
    // NAT64(64:ff9b::/96): 박힌 IPv4 로 판정한다 — 13.230.129.78 은 공개, 127.0.0.1·10.0.0.1 은 여전히 막힌다
    expect(ipKind("64:ff9b::de6:814e")).toBe("public");
    expect(ipKind("64:ff9b::13.230.129.78")).toBe("public");
    expect(ipKind("64:ff9b::7f00:1")).toBe("loopback");
    expect(ipKind("64:ff9b::a00:1")).toBe("private");
    expect(ipKind("64:ff9b:1::de6:814e")).toBe("special");
  });

  it("로컬·메타데이터·사설 주소와 잘못된 스킴을 거부한다", () => {
    for (const u of ["http://localhost:3000/x", "http://127.0.0.1/", "http://169.254.169.254/computeMetadata/v1/", "http://metadata.google.internal/", "http://[::1]/", "http://10.0.0.5/hook", "http://app.internal/", "ftp://hooks.example/", "https://user:pw@hooks.example/", "not a url"]) {
      expect(() => assertSafeWebhookUrl(u), u).toThrow();
    }
    expect(assertSafeWebhookUrl("https://hooks.slack.com/services/T/B/x").hostname).toBe("hooks.slack.com");
  });

  it("WEBHOOK_ALLOW_PRIVATE=true 면 사설망은 허용하되 로컬·메타데이터는 계속 막는다", () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = "true";
    expect(assertSafeWebhookUrl("http://192.168.10.20:8065/hooks/abc").port).toBe("8065");
    expect(assertSafeWebhookUrl("http://chat.internal/hooks/abc").hostname).toBe("chat.internal");
    expect(() => assertSafeWebhookUrl("http://127.0.0.1/")).toThrow();
    expect(() => assertSafeWebhookUrl("http://169.254.169.254/")).toThrow();
  });

  it("전송 직전 해석 결과도 검사한다", async () => {
    await expect(assertResolvesSafe(new URL("http://127.0.0.1/"))).rejects.toThrow();
    await expect(assertResolvesSafe(new URL("http://localhost/"))).rejects.toThrow();
    await expect(assertResolvesSafe(new URL("https://no-such-host.invalid/"))).resolves.toBeUndefined();
  });
});

describe("업로드 매직 바이트", () => {
  it("PDF·PNG·JPEG 만 판정하고 나머지는 null", () => {
    expect(sniffMime(Buffer.from("%PDF-1.7\n%âãÏÓ"))).toBe("application/pdf");
    expect(sniffMime(Buffer.concat([Buffer.alloc(100, 0x20), Buffer.from("%PDF-1.4")]))).toBe("application/pdf");
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("image/png");
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffMime(Buffer.from("MZ\x90\x00"))).toBeNull();
    expect(sniffMime(Buffer.from("<html><script>"))).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
  });
});
