import { jwtVerify, SignJWT } from "jose";

/** sessionId 는 auth_sessions 행. 매 요청에서 그 행이 살아 있는지 본다 (ctx.ts) */
export type SessionData = { userId: string; branchId: string | null; sessionId: string };
/** 검증된 세션. issuedAt 은 비밀번호 변경 시각과 비교해 오래된 토큰을 걸러내는 데 쓴다 */
export type VerifiedSession = SessionData & { issuedAt: number };

const COOKIE_NAME = "byeolha_session";
const DEFAULT_TTL = 12 * 60 * 60; // 12시간

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET 은 32자 이상이어야 합니다");
  return new TextEncoder().encode(s);
}

export async function signSession(data: SessionData, opts: { ttlSeconds?: number } = {}): Promise<string> {
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ b: data.branchId, sid: data.sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(data.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(secret());
}

/** 서명·만료만 본다. 세션 번호(sid)가 없는 예전 토큰은 받지 않는다 — 서버에서 끊을 수 없는 토큰이기 때문이다 */
export async function verifySession(token: string | undefined | null): Promise<VerifiedSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.sid !== "string" || !payload.sid) return null;
    const b = payload.b;
    return { userId: payload.sub, branchId: typeof b === "string" ? b : null, sessionId: payload.sid, issuedAt: payload.iat ?? 0 };
  } catch {
    return null;
  }
}

export const sessionCookie = {
  name: COOKIE_NAME,
  ttlSeconds: DEFAULT_TTL,
};
