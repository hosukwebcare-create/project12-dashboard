"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { buildCtx, getCtx } from "@/lib/auth/ctx";
import { checkLoginIp, clearLoginFailures, recordLoginFailure } from "@/lib/auth/login-throttle";
import { sessionCookie, verifySession } from "@/lib/auth/session";
import { clientIp, userAgentOf } from "@/lib/client-ip";
import { safeNextPath } from "@/lib/safe-next";
import { authenticate, LOCK_MINUTES } from "@/modules/auth/login";
import { recordSecurityEvent } from "@/modules/security/events";
import { createSession, revokeSession } from "@/modules/security/sessions";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const loginId = String(formData.get("loginId") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!loginId || !password) return { error: "아이디와 비밀번호를 입력하세요" };

  // 아이디를 바꿔 가며 찍어 보는 시도는 계정 잠금으로 못 막으므로 IP 로도 막는다
  const h = await headers();
  const meta = { ip: clientIp(h), userAgent: userAgentOf(h) };
  const gate = checkLoginIp(meta.ip);
  if (!gate.ok) {
    await recordSecurityEvent({ kind: "login.ip_blocked", loginId, ...meta });
    return { error: `로그인 시도가 너무 많습니다. ${Math.ceil(gate.retryAfterSec / 60)}분 후 다시 시도하세요` };
  }

  const result = await authenticate(loginId, password);
  if (!result.ok) {
    recordLoginFailure(meta.ip);
    if (result.reason === "locked") {
      await recordSecurityEvent({ kind: result.justLocked ? "login.locked" : "login.failure", userId: result.userId, loginId, ...meta, detail: { lockedUntil: result.until.toISOString() } });
      const minutes = Math.max(1, Math.ceil((result.until.getTime() - Date.now()) / 60_000));
      return { error: `로그인 시도가 너무 많아 잠겼습니다. ${minutes}분 후 다시 시도하세요` };
    }
    await recordSecurityEvent({ kind: "login.failure", userId: result.userId ?? null, loginId, ...meta });
    const hint = result.remaining !== undefined && result.remaining <= 2 ? ` (${result.remaining}회 더 실패하면 ${LOCK_MINUTES}분 잠깁니다)` : "";
    return { error: `아이디 또는 비밀번호가 올바르지 않습니다${hint}` };
  }

  clearLoginFailures(meta.ip);
  const ctx = await buildCtx(result.userId, null);
  if (!ctx) return { error: "소속 지점이 없습니다. 관리자에게 문의하세요" };

  const sessionId = await createSession(result.userId, "password", meta);
  await recordSecurityEvent({ kind: "login.success", userId: result.userId, loginId, ...meta });
  await setSessionCookie({ userId: result.userId, branchId: ctx.branchId, sessionId });
  redirect(safeNextPath(next) ?? (ctx.role === "assistant" ? "/rounding" : "/"));
}

/** 로그아웃: 쿠키만 지우는 게 아니라 서버의 세션을 폐기한다. 그 쿠키를 복사해 둔 사람도 더는 못 쓴다 */
export async function logout(): Promise<void> {
  const store = await cookies();
  const session = await verifySession(store.get(sessionCookie.name)?.value);
  if (session) {
    await revokeSession(session.sessionId);
    const h = await headers();
    await recordSecurityEvent({ kind: "logout", userId: session.userId, ip: clientIp(h), userAgent: userAgentOf(h) });
  }
  await clearSessionCookie();
  redirect("/login");
}

/** 지점 전환. 같은 세션을 이어 쓰고 쿠키의 지점만 바꾼다 */
export async function switchBranch(formData: FormData): Promise<void> {
  const branchId = String(formData.get("branchId") ?? "");
  const ctx = await getCtx();
  if (!ctx.sessionId || !ctx.memberships.some((m) => m.branchId === branchId)) return;
  await setSessionCookie({ userId: ctx.userId, branchId, sessionId: ctx.sessionId });
  redirect("/");
}
