"use server";

import { withRequestRls } from "@/lib/rls";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { IssueStatus } from "@/db/schema";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { formToObject } from "@/lib/form";
import { addIssueComment, createIssue, updateIssue } from "./repo";

export async function createIssueAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    const title = String(fd.get("title") ?? "").trim();
    if (!title) return { error: "제목을 입력하세요" };
    const severity = String(fd.get("severity") ?? "normal");
    let id: string;
    try {
      id = await createIssue(ctx, {
        memberId: String(fd.get("memberId") ?? "") || null,
        title,
        body: String(fd.get("body") ?? "").trim() || null,
        severity: severity === "low" || severity === "high" ? severity : "normal",
        source: "manual",
        custom: (formToObject(fd).custom as Record<string, unknown> | undefined) ?? {},
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/issues");
    redirect(`/issues/${id}`);
  });
}

export async function updateIssueAction(fd: FormData): Promise<void> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    const id = String(fd.get("id") ?? "");
    const status = fd.get("status") ? (String(fd.get("status")) as IssueStatus) : undefined;
    const assignedTo = fd.has("assignedTo") ? String(fd.get("assignedTo")) || null : undefined;
    await updateIssue(ctx, id, { status, assignedTo });
    revalidatePath("/issues");
    revalidatePath(`/issues/${id}`);
  });
}

export async function addIssueCommentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    const id = String(fd.get("id") ?? "");
    try {
      await addIssueComment(ctx, id, String(fd.get("body") ?? ""));
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath(`/issues/${id}`);
    return { ok: true };
  });
}
