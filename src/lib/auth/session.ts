import { jwtVerify, SignJWT } from "jose";

export type SessionData = { userId: string; branchId: string | null };

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
  return new SignJWT({ b: data.branchId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(data.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(secret());
}

export async function verifySession(token: string | undefined | null): Promise<SessionData | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const b = payload.b;
    return { userId: payload.sub, branchId: typeof b === "string" ? b : null };
  } catch {
    return null;
  }
}

export const sessionCookie = {
  name: COOKIE_NAME,
  ttlSeconds: DEFAULT_TTL,
};
