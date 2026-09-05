"use server";

import { withRequestRls } from "@/lib/rls";
import { revalidatePath } from "next/cache";
import type { MealKind } from "@/db/schema";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { markSettlementPaid, setOrder, updateMealSettings } from "./repo";

export async function toggleOrderAction(input: { memberId: string; date: string; meal: MealKind; ordered: boolean; overrideReason?: string }): Promise<{ ok?: boolean; error?: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await setOrder(ctx, input);
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/meals");
    return { ok: true };
  });
}

export async function updateMealSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await updateMealSettings(ctx, {
        lunchPrice: Number(fd.get("lunchPrice") ?? 0),
        dinnerPrice: Number(fd.get("dinnerPrice") ?? 0),
        cutoffTime: String(fd.get("cutoffTime") ?? "23:59"),
        saturdayLunchOnly: fd.get("saturdayLunchOnly") === "on",
        sundayClosed: fd.get("sundayClosed") === "on",
        closedDates: String(fd.get("closedDates") ?? "")
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
        vendorName: String(fd.get("vendorName") ?? "").trim() || null,
        vendorPhone: String(fd.get("vendorPhone") ?? "").trim() || null,
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/meals", "layout");
    return { ok: true };
  });
}

export async function markPaidAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    const paidAmountRaw = String(fd.get("paidAmount") ?? "").trim();
    try {
      await markSettlementPaid(ctx, {
        memberId: String(fd.get("memberId") ?? ""),
        yearMonth: String(fd.get("yearMonth") ?? ""),
        paidAt: String(fd.get("paidAt") ?? "") || null,
        paidAmount: paidAmountRaw ? Number(paidAmountRaw) : null,
        note: String(fd.get("note") ?? "").trim() || null,
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/meals/settlement");
    return { ok: true };
  });
}
