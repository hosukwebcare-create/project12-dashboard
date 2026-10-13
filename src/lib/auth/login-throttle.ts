/**
 * IP 기준 로그인 시도 제한. 계정별 잠금(modules/auth/login.ts)은 아이디를 알고 있는 공격만 막으므로,
 * 아이디를 바꿔 가며 찍어 보는 시도는 여기서 막는다.
 *
 * 프로세스 메모리에만 둔다. 인스턴스를 여러 대로 늘리면 대수만큼 한도가 늘어나지만,
 * 계정별 잠금이 그대로 살아 있어 실효는 유지된다. (더 엄격히 하려면 Redis 로 옮긴다)
 */
const WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 20;
const MAX_KEYS = 10_000;

type Bucket = { failures: number[]; blockedUntil: number };
const buckets = new Map<string, Bucket>();


function prune(now: number): void {
  for (const [ip, b] of buckets) {
    b.failures = b.failures.filter((t) => now - t < WINDOW_MS);
    if (b.failures.length === 0 && b.blockedUntil <= now) buckets.delete(ip);
  }
}

/** 지금 이 IP 가 더 시도해도 되는지. 막혀 있으면 남은 초를 돌려준다 */
export function checkLoginIp(ip: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  const b = buckets.get(ip);
  if (!b || b.blockedUntil <= now) return { ok: true };
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.blockedUntil - now) / 1000)) };
}

/** 로그인 실패를 기록한다. 창 안에서 MAX_FAILURES 를 넘기면 창 길이만큼 막는다 */
export function recordLoginFailure(ip: string, now = Date.now()): void {
  if (buckets.size > MAX_KEYS) prune(now);
  const b = buckets.get(ip) ?? { failures: [], blockedUntil: 0 };
  b.failures = b.failures.filter((t) => now - t < WINDOW_MS);
  b.failures.push(now);
  if (b.failures.length >= MAX_FAILURES) {
    b.blockedUntil = now + WINDOW_MS;
    b.failures = [];
  }
  buckets.set(ip, b);
}

/** 로그인에 성공하면 그 IP 의 실패 기록을 지운다 */
export function clearLoginFailures(ip: string): void {
  buckets.delete(ip);
}

/** 테스트용 */
export function resetLoginThrottle(): void {
  buckets.clear();
}

export const LOGIN_THROTTLE = { WINDOW_MS, MAX_FAILURES };
