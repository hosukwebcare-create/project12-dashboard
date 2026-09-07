"use server";

import { revalidatePath } from "next/cache";
import type { AppointmentKind, AppointmentStatus } from "@/db/schema";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { withRequestRls } from "@/lib/rls";
import { deleteAppointment, upsertAppointment } from "./repo";

export async function upsertAppointmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await upsertAppointment(ctx, {
        id: String(fd.get("id") ?? "") || undefined,
        date: String(fd.get("date") ?? ""),
        startTime: String(fd.get("startTime") ?? ""),
        endTime: String(fd.get("endTime") ?? "") || null,
        kind: String(fd.get("kind") ?? "new") as AppointmentKind,
        memberId: String(fd.get("memberId") ?? "") || null,
        personName: String(fd.get("personName") ?? "") || null,
        personPhone: String(fd.get("personPhone") ?? "") || null,
        assignedTo: String(fd.get("assignedTo") ?? "") || null,
        note: String(fd.get("note") ?? "") || null,
        status: (String(fd.get("status") ?? "scheduled") || "scheduled") as AppointmentStatus,
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/counsel/schedule");
    revalidatePath("/");
    return { ok: true };
  });
}

export async function deleteAppointmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await deleteAppointment(ctx, String(fd.get("id") ?? ""));
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/counsel/schedule");
    return { ok: true };
  });
}
