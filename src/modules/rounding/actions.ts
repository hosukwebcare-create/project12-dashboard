"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toMessage } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { todayKey } from "@/lib/rules/week";
import { completeSession, startSession, upsertCheck, type CheckInput, type SessionSummary } from "./repo";

export async function startSessionAction(fd: FormData): Promise<void> {
  const ctx = await getCtx();
  const date = String(fd.get("date") ?? "") || todayKey();
  let id: string;
  try {
    id = await startSession(ctx, date);
  } catch (e) {
    redirect(`/rounding?error=${encodeURIComponent(toMessage(e))}`);
  }
  revalidatePath("/rounding");
  redirect(`/rounding/${id}`);
}

export async function saveCheckAction(input: CheckInput): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getCtx();
  try {
    await upsertCheck(ctx, input);
  } catch (e) {
    return { error: toMessage(e) };
  }
  return { ok: true };
}

export async function completeSessionAction(sessionId: string): Promise<{ summary?: SessionSummary; error?: string }> {
  const ctx = await getCtx();
  try {
    const summary = await completeSession(ctx, sessionId);
    revalidatePath("/rounding");
    return { summary };
  } catch (e) {
    return { error: toMessage(e) };
  }
}
