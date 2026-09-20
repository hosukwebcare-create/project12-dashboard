"use server";

import { withRequestRls } from "@/lib/rls";
import { revalidatePath } from "next/cache";
import { toMessage, type ActionState } from "@/lib/action-utils";
import type { StaffGroup } from "@/db/schema";
import { getCtx } from "@/lib/auth/ctx";
import { parseHoursToX100 } from "@/lib/rules/worklog";
import { applyGroupSlotPreset, clockIn, clockOut, confirmWorkLog, saveWorkLog, unconfirmWorkLog, upsertShiftSlot, upsertStaffProfile } from "./repo";

export async function saveWorkLogAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
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
  });
}

export async function confirmWorkLogAction(fd: FormData): Promise<void> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    const id = String(fd.get("id") ?? "");
    if (fd.get("undo")) await unconfirmWorkLog(ctx, id);
    else await confirmWorkLog(ctx, id);
    revalidatePath("/worklog", "layout");
  });
}

export async function upsertShiftSlotAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
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
        audience: (String(fd.get("audience") ?? "") || null) as StaffGroup | null,
        sort: Number(fd.get("sort") ?? 0),
        active: fd.get("active") === "on" || fd.get("active") === "true",
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/worklog", "layout");
    return { ok: true };
  });
}

export async function upsertStaffProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    const rateRaw = String(fd.get("hourlyRate") ?? "").trim();
    const targetRaw = String(fd.get("targetHours") ?? "").trim();
    const weeklyRaw = String(fd.get("weeklyTargetHours") ?? "").trim();
    if (targetRaw && parseHoursToX100(targetRaw) === null) return { error: "하루 근무 예정 시간은 8 또는 7.5 같은 형식으로 입력하세요" };
    if (weeklyRaw && parseHoursToX100(weeklyRaw) === null) return { error: "주 소정근로시간은 40 같은 형식으로 입력하세요" };
    try {
      await upsertStaffProfile(ctx, {
        userId: String(fd.get("userId") ?? ""),
        employmentType: String(fd.get("employmentType") ?? "주간조교"),
        hourlyRate: rateRaw ? Number(rateRaw) : null,
        workDays: String(fd.get("workDays") ?? "").trim() || null,
        direct: fd.get("direct") === "on",
        targetHoursX100: targetRaw ? parseHoursToX100(targetRaw) : null,
        weeklyTargetHoursX100: weeklyRaw ? parseHoursToX100(weeklyRaw) : null,
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/worklog", "layout");
    return { ok: true };
  });
}

/**
 * 출근·퇴근. 시각은 서버에서 찍는다 — 브라우저 시계를 믿으면 근무 시간이 조작된다.
 * 대시보드와 근무 화면 양쪽에 같은 카드가 있어 두 경로를 모두 다시 그린다.
 */
export async function clockInAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await clockIn(ctx, String(fd.get("date") ?? ""));
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/worklog", "layout");
    revalidatePath("/");
    return { ok: true };
  });
}

export async function clockOutAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await clockOut(ctx, String(fd.get("date") ?? ""));
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/worklog", "layout");
    revalidatePath("/");
    return { ok: true };
  });
}

/** 직군별 기본 타임 넣기. 버튼 하나짜리 폼이라 입력값은 없다 */
export async function applyGroupSlotPresetAction(): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await applyGroupSlotPreset(ctx);
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/worklog", "layout");
    return { ok: true };
  });
}
