"use server";

import { revalidatePath } from "next/cache";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { parseHoursToX100 } from "@/lib/rules/worklog";
import { confirmWorkLog, saveWorkLog, unconfirmWorkLog, upsertShiftSlot, upsertStaffProfile } from "./repo";

export async function saveWorkLogAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getCtx();
  const overtime = parseHoursToX100(String(fd.get("overtime") ?? ""));
  if (overtime === null) return { error: "초과근무 시간은 0.25 같은 소수 형식으로 입력하세요" };
  try {
    await saveWorkLog(ctx, {
      userId: String(fd.get("userId") ?? "") || undefined,
      date: String(fd.get("date") ?? ""),
      slotKeys: fd.getAll("slot").map(String),
      overtimeX100: overtime,
      overtimeReason: String(fd.get("overtimeReason") ?? "").trim() || null,
      note: String(fd.get("note") ?? "").trim() || null,
    });
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/worklog", "layout");
  return { ok: true };
}

export async function confirmWorkLogAction(fd: FormData): Promise<void> {
  const ctx = await getCtx();
  const id = String(fd.get("id") ?? "");
  if (fd.get("undo")) await unconfirmWorkLog(ctx, id);
  else await confirmWorkLog(ctx, id);
  revalidatePath("/worklog", "layout");
}

export async function upsertShiftSlotAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getCtx();
  const hours = parseHoursToX100(String(fd.get("hours") ?? ""));
  if (hours === null) return { error: "인정 시간은 0.5 같은 소수 형식" };
  try {
    await upsertShiftSlot(ctx, {
      id: String(fd.get("id") ?? "") || undefined,
      key: String(fd.get("key") ?? ""),
      label: String(fd.get("label") ?? ""),
      startTime: String(fd.get("startTime") ?? ""),
      endTime: String(fd.get("endTime") ?? ""),
      hoursX100: hours,
      weekend: fd.get("weekend") === "on",
      sort: Number(fd.get("sort") ?? 0),
      active: fd.get("active") === "on" || fd.get("active") === "true",
    });
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/worklog", "layout");
  return { ok: true };
}

export async function upsertStaffProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getCtx();
  const rateRaw = String(fd.get("hourlyRate") ?? "").trim();
  try {
    await upsertStaffProfile(ctx, {
      userId: String(fd.get("userId") ?? ""),
      employmentType: String(fd.get("employmentType") ?? "주간조교"),
      hourlyRate: rateRaw ? Number(rateRaw) : null,
      workDays: String(fd.get("workDays") ?? "").trim() || null,
      direct: fd.get("direct") === "on",
    });
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/worklog", "layout");
  return { ok: true };
}
