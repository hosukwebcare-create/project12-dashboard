import { beforeEach, describe, expect, it } from "vitest";
import { hitRateLimit, resetRateLimits } from "@/lib/rate-limit";

describe("요청 수 제한", () => {
  beforeEach(resetRateLimits);
  const rule = { limit: 3, windowMs: 60_000 };

  it("한도까지는 통과, 넘으면 남은 초와 함께 거부", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(hitRateLimit("ip:a", rule, t)).toEqual({ ok: true });
    expect(hitRateLimit("ip:a", rule, t + 10_000)).toEqual({ ok: false, retryAfterSec: 50 });
  });
  it("키마다 따로 세고, 창이 지나면 다시 센다", () => {
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) hitRateLimit("ip:a", rule, t);
    expect(hitRateLimit("ip:b", rule, t)).toEqual({ ok: true });
    expect(hitRateLimit("ip:a", rule, t + 60_000)).toEqual({ ok: true });
  });
});
