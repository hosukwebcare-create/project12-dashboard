"use server";

import { revalidatePath } from "next/cache";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { getProvider } from "./provider";
import { buildRecipients, processQueue, queueMessages, retryFailed, upsertTemplate, type RecipientType } from "./repo";

export type SendState = ActionState & { batchId?: string; queued?: number; skipped?: number; sent?: number; failed?: number };

export async function sendAlimtalkAction(_p: SendState, fd: FormData): Promise<SendState> {
  const ctx = await getCtx();
  const group = String(fd.get("group") ?? "all") as "all" | "focus" | "members";
  const recipientType = (fd.get("recipientType") === "guardian" ? "guardian" : "member") as RecipientType;
  const memberIds = fd.getAll("memberId").map(String);
  const extraVars: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("var.") && typeof v === "string") extraVars[k.slice(4)] = v;
  }
  try {
    const recipients = await buildRecipients(ctx, { group, memberIds, recipientType });
    if (recipients.length === 0) return { error: "발송 대상이 없습니다" };
    const q = await queueMessages(ctx, { templateId: String(fd.get("templateId") ?? ""), recipients, extraVars });
    const r = await processQueue(getProvider(), 500);
    revalidatePath("/alimtalk", "layout");
    return { ok: true, ...q, ...r };
  } catch (e) {
    return { error: toMessage(e) };
  }
}

export async function retryFailedAction(fd: FormData): Promise<void> {
  const ctx = await getCtx();
  await retryFailed(ctx, String(fd.get("batchId") ?? ""));
  await processQueue(getProvider(), 500);
  revalidatePath("/alimtalk", "layout");
}

export async function upsertTemplateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getCtx();
  try {
    await upsertTemplate(ctx, {
      id: String(fd.get("id") ?? "") || undefined,
      code: String(fd.get("code") ?? ""),
      name: String(fd.get("name") ?? ""),
      body: String(fd.get("body") ?? ""),
      active: fd.get("active") === "on" || fd.get("active") === "true",
    });
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/settings/alimtalk-templates");
  revalidatePath("/alimtalk");
  return { ok: true };
}
