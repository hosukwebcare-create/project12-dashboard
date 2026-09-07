"use server";

import { revalidatePath } from "next/cache";
import type { SeatPaymentStatus } from "@/db/schema";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { withRequestRls } from "@/lib/rls";
import { bulkSetSeatFeePlan, saveSeatPayment, setSeatFeePlan, upsertFeePlan } from "./repo";

const num = (v: FormDataEntryValue | null, d = 0) => {
  const n = Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : d;
};

export async function upsertFeePlanAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await upsertFeePlan(ctx, {
        id: String(fd.get("id") ?? "") || undefined,
        name: String(fd.get("name") ?? ""),
        studentPrice: num(fd.get("studentPrice")),
        adultPrice: num(fd.get("adultPrice")),
        sort: num(fd.get("sort")),
        active: fd.get("active") === "on" || fd.get("active") === "true",
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/settings/fees");
    revalidatePath("/payments");
    return { ok: true };
  });
}

export async function setSeatFeePlanAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await setSeatFeePlan(ctx, String(fd.get("seatId") ?? ""), String(fd.get("feePlanId") ?? "") || null);
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/settings/fees");
    return { ok: true };
  });
}

export async function bulkSetSeatFeePlanAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await bulkSetSeatFeePlan(ctx, num(fd.get("from"), 1), num(fd.get("to"), 1), String(fd.get("feePlanId") ?? "") || null);
      revalidatePath("/settings/fees");
      revalidatePath("/payments");
      return { ok: true };
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}

export async function saveSeatPaymentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await saveSeatPayment(ctx, {
        id: String(fd.get("id") ?? "") || undefined,
        enrollmentId: String(fd.get("enrollmentId") ?? ""),
        memberId: String(fd.get("memberId") ?? ""),
        periodStart: String(fd.get("periodStart") ?? ""),
        periodEnd: String(fd.get("periodEnd") ?? ""),
        planName: String(fd.get("planName") ?? "") || null,
        baseAmount: num(fd.get("baseAmount")),
        discount: num(fd.get("discount")),
        paidAt: String(fd.get("paidAt") ?? "") || null,
        paidAmount: fd.get("paidAmount") ? num(fd.get("paidAmount")) : null,
        status: (String(fd.get("status") ?? "pending") || "pending") as SeatPaymentStatus,
        note: String(fd.get("note") ?? "") || null,
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/payments");
    revalidatePath("/");
    return { ok: true };
  });
}
