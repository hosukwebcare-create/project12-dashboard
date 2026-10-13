"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { setSessionCookie } from "@/lib/auth/cookies";
import { getCtx } from "@/lib/auth/ctx";
import { clientIp, userAgentOf } from "@/lib/client-ip";
import { withRequestRls } from "@/lib/rls";
import { recordSecurityEvent } from "@/modules/security/events";
import { createSession, revokeSession } from "@/modules/security/sessions";
import { switchByPin } from "./pin";

/**
 * PIN 전환. 태블릿의 지금 세션을 끝내고, 대상 조교의 새 세션을 이 지점에만 묶어 연다
 * (PIN 을 알아낸 사람이 그 조교의 다른 지점 권한까지 쓰지 못하게).
 */
export async function switchByPinAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    const userId = String(fd.get("userId") ?? "");
    const pin = String(fd.get("pin") ?? "");
    const h = await headers();
    const meta = { ip: clientIp(h), userAgent: userAgentOf(h) };
    let target: { userId: string; branchId: string };
    try {
      target = await switchByPin(ctx, userId, pin, undefined, undefined, (o) =>
        recordSecurityEvent({ kind: o.kind === "success" ? "pin.success" : o.kind === "locked" ? "pin.locked" : "pin.failure", userId: o.targetId, actorId: ctx.userId, ...meta, detail: { branchId: ctx.branchId } }),
      );
    } catch (e) {
      return { error: toMessage(e) };
    }
    if (ctx.sessionId) await revokeSession(ctx.sessionId);
    const sessionId = await createSession(target.userId, "pin", { ...meta, branchId: target.branchId });
    await setSessionCookie({ ...target, sessionId });
    redirect("/rounding");
  });
}
