"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { buildCtx, getCtx } from "@/lib/auth/ctx";
import { verifyPassword } from "@/lib/auth/password";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const loginId = String(formData.get("loginId") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!loginId || !password) return { error: "아이디와 비밀번호를 입력하세요" };

  const [user] = await db.select().from(users).where(eq(users.loginId, loginId)).limit(1);
  const ok = user && user.active && (await verifyPassword(password, user.passwordHash));
  if (!ok) return { error: "아이디 또는 비밀번호가 올바르지 않습니다" };

  const ctx = await buildCtx(user.id, null);
  if (!ctx) return { error: "소속 지점이 없습니다. 관리자에게 문의하세요" };

  await setSessionCookie({ userId: user.id, branchId: ctx.branchId });
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
