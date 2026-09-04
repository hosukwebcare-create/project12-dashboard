"use server";

import { redirect } from "next/navigation";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { setSessionCookie } from "@/lib/auth/cookies";
import { getCtx } from "@/lib/auth/ctx";
import { switchByPin } from "./pin";

export async function switchByPinAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getCtx();
  const userId = String(fd.get("userId") ?? "");
  const pin = String(fd.get("pin") ?? "");
  let target: { userId: string; branchId: string };
  try {
    target = await switchByPin(ctx, userId, pin);
  } catch (e) {
    return { error: toMessage(e) };
  }
  await setSessionCookie(target);
  redirect("/rounding");
}
