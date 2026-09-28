"use server";

import { withRequestRls } from "@/lib/rls";
import { revalidatePath } from "next/cache";
import { toMessage, type ActionState } from "@/lib/action-utils";
import type { SlotAudience } from "@/db/schema";
import { getCtx } from "@/lib/auth/ctx";
import { parseHoursToX100, parseMinutes } from "@/lib/rules/worklog";
import { applySheetSlotPreset, clockIn, clockOut, confirmWorkLog, patchStaffProfile, patchWorkLog, saveWorkLog, unconfirmWorkLog, upsertShiftSlot, upsertStaffProfile } from "./repo";

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

/**
 * 본사 확인·취소. 일별 현황 표가 돌려받은 값으로 그 줄만 고친다 —
 * 화면 전체를 다시 그리면 다른 줄에 적고 있던 초과근무·사유가 날아간다.
 */
export async function setWorkLogConfirmedAction(input: { id: string; confirmed: boolean }): Promise<{ confirmedBy?: string | null; error?: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      if (!input.confirmed) {
        await unconfirmWorkLog(ctx, input.id);
        return { confirmedBy: null };
      }
      return { confirmedBy: (await confirmWorkLog(ctx, input.id)) ?? "본사" };
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}

export async function upsertShiftSlotAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    const minutes = parseMinutes(String(fd.get("minutes") ?? ""));
    if (minutes === null) return { error: "인정 시간은 분 단위 정수로 입력하세요 (예: 15)" };
    try {
      await upsertShiftSlot(ctx, {
        id: String(fd.get("id") ?? "") || undefined,
        key: String(fd.get("key") ?? ""),
        label: String(fd.get("label") ?? ""),
        startTime: String(fd.get("startTime") ?? ""),
        endTime: String(fd.get("endTime") ?? ""),
        minutes,
        weekend: fd.get("weekend") === "on",
        audience: (String(fd.get("audience") ?? "") || null) as SlotAudience | null,
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

/** 시트 타임표 넣기. 버튼 하나짜리 폼이라 입력값은 없다 */
export async function applySheetSlotPresetAction(): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await applySheetSlotPreset(ctx);
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/worklog", "layout");
    return { ok: true };
  });
}

/**
 * 일별 현황 표에서 그 줄의 타임 체크·초과근무를 바로 고친다. 고친 뒤의 근무 시간을 돌려준다.
 * 체크를 다 풀어 기록이 지워졌으면 log 가 null 이다.
 */
export async function patchWorkLogAction(input: { userId: string; date: string; slotKeys?: string[]; overtime?: string; overtimeReason?: string | null }): Promise<{ log?: { id: string; slotKeys: string[]; hoursX100: number; overtimeX100: number; overtimeReason: string | null; locked: boolean } | null; error?: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    let overtimeX100: number | undefined;
    if (input.overtime !== undefined) {
      const v = parseHoursToX100(input.overtime);
      if (v === null) return { error: "초과근무는 0.5 같은 시간으로 적어 주세요" };
      overtimeX100 = v;
    }
    try {
      // 표가 돌려받은 값으로 그 줄을 고친다. 화면 전체를 다시 그리면 다른 줄에 입력 중인 글자가 날아간다
      const log = await patchWorkLog(ctx, { userId: input.userId, date: input.date, slotKeys: input.slotKeys, overtimeX100, overtimeReason: input.overtimeReason === undefined ? undefined : input.overtimeReason?.trim() || null });
      return { log: log ? { id: log.id, slotKeys: log.slotKeys, hoursX100: log.hoursX100, overtimeX100: log.overtimeX100, overtimeReason: log.overtimeReason, locked: Boolean(log.hqConfirmedAt) } : null };
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}

/** 직원 근무 정보 한 칸(근무 형태·근무 요일·시급)을 그 자리에서 고친다 */
export async function patchStaffProfileAction(input: { userId: string; employmentType?: string; workDays?: string; hourlyRate?: string }): Promise<{ ok?: boolean; error?: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    let hourlyRate: number | null | undefined;
    if (input.hourlyRate !== undefined) {
      const raw = input.hourlyRate.replace(/[,\s원]/g, "");
      if (raw && !/^\d+$/.test(raw)) return { error: "시급은 숫자로 적어 주세요" };
      hourlyRate = raw ? Number(raw) : null;
    }
    try {
      await patchStaffProfile(ctx, input.userId, {
        employmentType: input.employmentType,
        workDays: input.workDays === undefined ? undefined : input.workDays.trim() || null,
        hourlyRate,
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    return { ok: true };
  });
}
