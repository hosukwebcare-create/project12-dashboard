"use server";

import { withRequestRls } from "@/lib/rls";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { upsertApplication, upsertRound } from "./repo";

export async function upsertRoundAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    let id: string;
    try {
      id = await upsertRound(ctx, {
        id: String(fd.get("id") ?? "") || undefined,
        yearMonth: String(fd.get("yearMonth") ?? ""),
        name: String(fd.get("name") ?? ""),
        price: Number(fd.get("price") ?? 0),
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/mock-exams");
    if (!fd.get("id")) redirect(`/mock-exams/${id}`);
    return { ok: true };
  });
}

export async function upsertApplicationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    const roundId = String(fd.get("roundId") ?? "");
    try {
      const paidAmountRaw = String(fd.get("paidAmount") ?? "").trim();
      await upsertApplication(ctx, {
        roundId,
        memberId: String(fd.get("memberId") ?? ""),
        applied: fd.get("applied") === "on" || fd.get("applied") === "true",
        track: String(fd.get("track") ?? "") || null,
        subjects: String(fd.get("subjects") ?? "").trim() || null,
        paidAt: String(fd.get("paidAt") ?? "") || null,
        paidAmount: paidAmountRaw ? Number(paidAmountRaw) : null,
        note: String(fd.get("note") ?? "").trim() || null,
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath(`/mock-exams/${roundId}`);
    revalidatePath("/mock-exams");
    return { ok: true };
  });
}
