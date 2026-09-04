"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { MemberStatus } from "@/db/schema";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { assignSeat, changeStatus, createMember, updateMember } from "./repo";
import { formToMemberInput, MEMBER_STATUSES, type MemberInput } from "./schema";

export async function createMemberAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getCtx();
  let id: string;
  try {
    id = await createMember(ctx, formToMemberInput(fd) as MemberInput);
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/members");
  redirect(`/members/${id}`);
}

export async function updateMemberAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getCtx();
  const id = String(fd.get("id") ?? "");
  try {
    await updateMember(ctx, id, formToMemberInput(fd) as MemberInput);
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/members");
  revalidatePath(`/members/${id}`);
  redirect(`/members/${id}`);
}

export async function changeStatusAction(fd: FormData): Promise<void> {
  const ctx = await getCtx();
  const id = String(fd.get("id") ?? "");
  const status = String(fd.get("status") ?? "") as MemberStatus;
  if (!MEMBER_STATUSES.includes(status)) return;
  await changeStatus(ctx, id, status);
  revalidatePath("/members");
  revalidatePath(`/members/${id}`);
}

export async function assignSeatAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getCtx();
  const id = String(fd.get("id") ?? "");
  const seatId = String(fd.get("seatId") ?? "") || null;
  try {
    await assignSeat(ctx, id, seatId);
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/members");
  revalidatePath(`/members/${id}`);
  return { ok: true };
}
