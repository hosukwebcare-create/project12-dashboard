"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { buildCtx, getCtx } from "@/lib/auth/ctx";
import { checkLoginIp, clearLoginFailures, clientIp, recordLoginFailure } from "@/lib/auth/login-throttle";
import { authenticate, LOCK_MINUTES } from "@/modules/auth/login";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const loginId = String(formData.get("loginId") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!loginId || !password) return { error: "아이디와 비밀번호를 입력하세요" };

  // 아이디를 바꿔 가며 찍어 보는 시도는 계정 잠금으로 못 막으므로 IP 로도 막는다
  const ip = clientIp(await headers());
  const gate = checkLoginIp(ip);
  if (!gate.ok) return { error: `로그인 시도가 너무 많습니다. ${Math.ceil(gate.retryAfterSec / 60)}분 후 다시 시도하세요` };

  const result = await authenticate(loginId, password);
  if (!result.ok) {
    recordLoginFailure(ip);
    if (result.reason === "locked") {
      const minutes = Math.max(1, Math.ceil((result.until.getTime() - Date.now()) / 60_000));
      return { error: `로그인 시도가 너무 많아 잠겼습니다. ${minutes}분 후 다시 시도하세요` };
    }
    const hint = result.remaining !== undefined && result.remaining <= 2 ? ` (${result.remaining}회 더 실패하면 ${LOCK_MINUTES}분 잠깁니다)` : "";
    return { error: `아이디 또는 비밀번호가 올바르지 않습니다${hint}` };
  }

  clearLoginFailures(ip);
  const ctx = await buildCtx(result.userId, null);
  if (!ctx) return { error: "소속 지점이 없습니다. 관리자에게 문의하세요" };

  await setSessionCookie({ userId: result.userId, branchId: ctx.branchId });
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : null;
  redirect(safeNext ?? (ctx.role === "assistant" ? "/rounding" : "/"));
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

export async function switchBranch(formData: FormData): Promise<void> {
  const branchId = String(formData.get("branchId") ?? "");
  const ctx = await getCtx();
  if (!ctx.memberships.some((m) => m.branchId === branchId)) return;
  await setSessionCookie({ userId: ctx.userId, branchId });
  redirect("/");
}
