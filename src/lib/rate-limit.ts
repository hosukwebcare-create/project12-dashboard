/**
 * 고정 창 요청 수 제한(메모리). 로그인 없이 열려 있는 주소(현황판·잔디·HERO)를 한 IP 가 마구 두드리지 못하게 한다.
 * 프로세스마다 따로 센다 — 인스턴스를 늘리면 그만큼 한도가 늘지만, 토큰·서명 검사가 그대로 살아 있으므로
 * 여기서는 "비싼 DB 조회를 무한정 일으키지 못하게"가 목적이다.
 */
export type RateRule = { limit: number; windowMs: number };

const MAX_KEYS = 20_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function hitRateLimit(key: string, rule: RateRule, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  if (buckets.size > MAX_KEYS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    // 그래도 넘치면(공격으로 키가 폭증) 통째로 비운다. 한도를 잠깐 놓치는 편이 메모리가 터지는 것보다 낫다
    if (buckets.size > MAX_KEYS) buckets.clear();
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { ok: true };
  }
  b.count += 1;
  if (b.count > rule.limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  return { ok: true };
}

/** 테스트용 */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * 로그인 없이 열린 경로별 한도. 현황판은 매장 TV·태블릿 여러 대가 한 IP(매장 공유기)에서 1분마다 새로 고치므로 넉넉하게.
 * 잔디는 잔디 서버가 보내고(분당 60건이 잔디 쪽 한도), HERO 는 결과가 나올 때만 온다.
 */
export const PUBLIC_RATE_RULES: { prefix: string; group: string; rule: RateRule }[] = [
  { prefix: "/api/board/", group: "board", rule: { limit: 600, windowMs: 60_000 } },
  { prefix: "/board/", group: "board", rule: { limit: 600, windowMs: 60_000 } },
  { prefix: "/api/integrations/", group: "integrations", rule: { limit: 120, windowMs: 60_000 } },
];
