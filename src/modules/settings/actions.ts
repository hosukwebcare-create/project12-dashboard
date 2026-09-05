"use server";

import { withRequestRls } from "@/lib/rls";
import { revalidatePath } from "next/cache";
import type { BranchRole } from "@/db/schema";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { issueBoardToken } from "@/modules/board/repo";
import type { CustomFieldType } from "@/lib/rules/custom-fields";
import { bulkCreateSeats, setUserPin, updateBranchSettings, upsertBoardItem, upsertCustomFieldDef, upsertPenaltyRule, upsertSeat, upsertUser, type CustomFieldEntity } from "./repo";

const num = (v: FormDataEntryValue | null, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v: FormDataEntryValue | null) => v === "on" || v === "true";

export async function updateBranchSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      const schedule = String(fd.get("roundSchedule") ?? "")
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await updateBranchSettings(ctx, { roundsPerDay: num(fd.get("roundsPerDay"), 12), maskNames: bool(fd.get("maskNames")), roundSchedule: schedule });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export type TokenState = ActionState & { token?: string };

export async function issueBoardTokenAction(): Promise<TokenState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      const token = await issueBoardToken(ctx);
      return { ok: true, token };
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}

export async function upsertPenaltyRuleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await upsertPenaltyRule(ctx, {
        id: String(fd.get("id") ?? "") || undefined,
        name: String(fd.get("name") ?? ""),
        points: num(fd.get("points")),
        sort: num(fd.get("sort")),
        active: bool(fd.get("active")),
        global: bool(fd.get("global")),
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/settings/penalty-rules");
    return { ok: true };
  });
}

export async function upsertSeatAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await upsertSeat(ctx, { id: String(fd.get("id") ?? "") || undefined, seatNo: num(fd.get("seatNo")), zone: String(fd.get("zone") ?? "A"), sort: num(fd.get("sort")), active: bool(fd.get("active")) });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/settings/seats");
    return { ok: true };
  });
}

export async function bulkCreateSeatsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      const n = await bulkCreateSeats(ctx, num(fd.get("from"), 1), num(fd.get("to"), 1), String(fd.get("zone") ?? "A"));
      revalidatePath("/settings/seats");
      return { ok: true, error: n === 0 ? "추가할 좌석이 없습니다 (모두 존재)" : undefined };
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}

export async function upsertBoardItemAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await upsertBoardItem(ctx, {
        id: String(fd.get("id") ?? "") || undefined,
        key: String(fd.get("key") ?? ""),
        label: String(fd.get("label") ?? ""),
        kind: fd.get("kind") === "round" ? "round" : "daily",
        sort: num(fd.get("sort")),
        active: bool(fd.get("active")),
        global: bool(fd.get("global")),
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/settings/board-items");
    return { ok: true };
  });
}

export async function upsertUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      const password = String(fd.get("password") ?? "");
      await upsertUser(ctx, {
        id: String(fd.get("id") ?? "") || undefined,
        loginId: String(fd.get("loginId") ?? ""),
        name: String(fd.get("name") ?? ""),
        phone: String(fd.get("phone") ?? "") || null,
        password: password || undefined,
        role: String(fd.get("role") ?? "assistant") as BranchRole,
        active: bool(fd.get("active")),
      });
      const pin = String(fd.get("pin") ?? "");
      const id = String(fd.get("id") ?? "");
      if (pin && id) await setUserPin(ctx, id, pin);
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/settings/users");
    return { ok: true };
  });
}

export async function upsertCustomFieldDefAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await upsertCustomFieldDef(ctx, {
        id: String(fd.get("id") ?? "") || undefined,
        entity: String(fd.get("entity") ?? "member") as CustomFieldEntity,
        key: String(fd.get("key") ?? ""),
        label: String(fd.get("label") ?? ""),
        type: String(fd.get("type") ?? "text") as CustomFieldType,
        options: String(fd.get("options") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        required: bool(fd.get("required")),
        sort: num(fd.get("sort")),
        active: bool(fd.get("active")),
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/settings/custom-fields");
    revalidatePath("/members", "layout");
    return { ok: true };
  });
}
