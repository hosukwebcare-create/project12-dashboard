"use server";

import { revalidatePath } from "next/cache";
import type { MemberFileKind } from "@/db/schema";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { saveMemberFile } from "./repo";

export async function uploadMemberFileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getCtx();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "파일을 선택하세요" };
  const memberId = String(fd.get("memberId") ?? "");
  const kindRaw = String(fd.get("kind") ?? "other");
  const kind: MemberFileKind = kindRaw === "hero_result" || kindRaw === "ai_report" ? kindRaw : "other";
  try {
    await saveMemberFile(ctx, { memberId, kind, title: String(fd.get("title") ?? ""), fileName: file.name, mimeType: file.type || "application/octet-stream", data: Buffer.from(await file.arrayBuffer()) });
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath(`/members/${memberId}`);
  return { ok: true };
}
