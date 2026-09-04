"use server";

import { revalidatePath } from "next/cache";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { dispatchOutbox, retryFailedEvents, upsertWebhookEndpoint } from "./repo";

export async function upsertWebhookAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getCtx();
  try {
    await upsertWebhookEndpoint(ctx, {
      id: String(fd.get("id") ?? "") || undefined,
      name: String(fd.get("name") ?? ""),
      url: String(fd.get("url") ?? ""),
      events: fd.getAll("events").map(String),
      active: fd.get("active") === "on" || fd.get("active") === "true",
    });
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/settings/webhooks");
  return { ok: true };
}

export async function dispatchNowAction(): Promise<void> {
  const ctx = await getCtx();
  await retryFailedEvents(ctx);
  await dispatchOutbox(undefined, 100);
  revalidatePath("/settings/webhooks");
}
