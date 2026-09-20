"use server";

import { withRequestRls } from "@/lib/rls";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toMessage } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { todayKey } from "@/lib/rules/week";
import { completeSession, fillRemaining, startSession, upsertCheck, type CheckInput, type SessionSummary } from "./repo";

export async function startSessionAction(fd: FormData): Promise<void> {
  return withRequestRls(async () => {
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
  });
}

export async function saveCheckAction(input: CheckInput): Promise<{ ok?: boolean; error?: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await upsertCheck(ctx, input);
    } catch (e) {
      return { error: toMessage(e) };
    }
    return { ok: true };
  });
}

export async function completeSessionAction(sessionId: string): Promise<{ summary?: SessionSummary; error?: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      const summary = await completeSession(ctx, sessionId);
      revalidatePath("/rounding");
      return { summary };
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}

export async function fillRemainingAction(input: { date: string; itemKey: string }): Promise<{ filled?: number; error?: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      const filled = await fillRemaining(ctx, input.date, input.itemKey);
      revalidatePath("/daily-checks");
      return { filled };
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}
