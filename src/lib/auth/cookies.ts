import { cookies } from "next/headers";
import { sessionCookie, signSession, type SessionData } from "./session";

export async function setSessionCookie(data: SessionData): Promise<void> {
  const token = await signSession(data);
  const store = await cookies();
  store.set(sessionCookie.name, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionCookie.ttlSeconds,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(sessionCookie.name);
}
