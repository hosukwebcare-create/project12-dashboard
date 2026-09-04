"use server";

import { revalidatePath } from "next/cache";
import type { CounselLogType } from "@/db/schema";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { addComment, upsertLog } from "./repo";

export type SaveLogState = ActionState & { logId?: string };

export async function saveLogAction(_prev: SaveLogState, fd: FormData): Promise<SaveLogState> {
  const ctx = await getCtx();
  const field = String(fd.get("field") ?? "") as "issue" | "resolution";
  const logType = String(fd.get("logType") ?? "weekly") as CounselLogType;
  try {
    const logId = await upsertLog(ctx, {
      memberId: String(fd.get("memberId") ?? ""),
      logType,
      periodDate: String(fd.get("periodDate") ?? ""),
      field,
      text: String(fd.get("text") ?? ""),
    });
    revalidatePath("/counsel/weekly");
    revalidatePath("/counsel/focus");
    revalidatePath(`/counsel/logs/${logId}`);
    return { ok: true, logId };
  } catch (e) {
    return { error: toMessage(e) };
  }
}

export async function addCommentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getCtx();
  const logId = String(fd.get("logId") ?? "");
  try {
    await addComment(ctx, logId, String(fd.get("body") ?? ""));
    revalidatePath(`/counsel/logs/${logId}`);
    return { ok: true };
  } catch (e) {
    return { error: toMessage(e) };
  }
}
