"use server";

import { revalidatePath } from "next/cache";
import type { HandoverKind } from "@/db/schema";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { withRequestRls } from "@/lib/rls";
import { addComment, deleteNote, markAllRead, markRead, setRequestDone, upsertNote } from "./repo";

export async function upsertNoteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await upsertNote(ctx, {
        id: String(fd.get("id") ?? "") || undefined,
        date: String(fd.get("date") ?? ""),
        slotKey: String(fd.get("slotKey") ?? "") || null,
        kind: (String(fd.get("kind") ?? "handover") || "handover") as HandoverKind,
        body: String(fd.get("body") ?? ""),
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/handover");
    return { ok: true };
  });
}

export async function deleteNoteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await deleteNote(ctx, String(fd.get("id") ?? ""));
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/handover");
    return { ok: true };
  });
}

export async function addCommentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await addComment(ctx, String(fd.get("noteId") ?? ""), String(fd.get("body") ?? ""));
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/handover");
    return { ok: true };
  });
}

export async function markReadAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await markRead(ctx, [String(fd.get("id") ?? "")]);
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/handover");
    return { ok: true };
  });
}

export async function markAllReadAction(): Promise<void> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    await markAllRead(ctx);
    revalidatePath("/handover");
  });
}

/** '해 주세요'를 했어요 / 되돌리기 */
export async function setRequestDoneAction(fd: FormData): Promise<void> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    await setRequestDone(ctx, String(fd.get("id") ?? ""), fd.get("done") === "1");
    revalidatePath("/handover");
    revalidatePath("/");
  });
}
