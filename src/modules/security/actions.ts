"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { setSessionCookie } from "@/lib/auth/cookies";
import { getCtx } from "@/lib/auth/ctx";
import { clientIp, userAgentOf } from "@/lib/client-ip";
import { withRequestRls } from "@/lib/rls";
import { forceLogoutUser } from "@/modules/settings/repo";
import { changeOwnPassword, logoutOtherDevices } from "./account";

async function requestMeta() {
  const h = await headers();
  return { ip: clientIp(h), userAgent: userAgentOf(h) };
}

export async function changeOwnPasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      const { sessionId } = await changeOwnPassword(ctx, String(fd.get("current") ?? ""), String(fd.get("next") ?? ""), String(fd.get("confirm") ?? ""), await requestMeta());
      await setSessionCookie({ userId: ctx.userId, branchId: ctx.branchId, sessionId });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/account");
    return { ok: true };
  });
}

export async function logoutOtherDevicesAction(): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await logoutOtherDevices(ctx, await requestMeta());
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/account");
    return { ok: true };
  });
}

/** 설정 › 사용자: 그 사람의 모든 기기 로그아웃 */
export async function forceLogoutUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await forceLogoutUser(ctx, String(fd.get("userId") ?? ""), await requestMeta());
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/settings/users");
    return { ok: true };
  });
}
