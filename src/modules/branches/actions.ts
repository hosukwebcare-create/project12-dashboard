"use server";

import { withRequestRls } from "@/lib/rls";
import { revalidatePath } from "next/cache";
import { toMessage, type ActionState } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { createBranch, setBranchActive, updateBranchInfo } from "./repo";

export async function createBranchAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    const loginId = String(fd.get("managerLoginId") ?? "").trim();
    try {
      await createBranch(ctx, {
        code: String(fd.get("code") ?? ""),
        name: String(fd.get("name") ?? ""),
        ownerName: String(fd.get("ownerName") ?? ""),
        seatCount: Number(fd.get("seatCount") ?? 0),
        roundsPerDay: Number(fd.get("roundsPerDay") ?? 12),
        manager: loginId ? { loginId, name: String(fd.get("managerName") ?? ""), password: String(fd.get("managerPassword") ?? "") } : undefined,
      });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function updateBranchInfoAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await updateBranchInfo(ctx, String(fd.get("id") ?? ""), { code: String(fd.get("code") ?? ""), name: String(fd.get("name") ?? ""), ownerName: String(fd.get("ownerName") ?? "") });
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function setBranchActiveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      await setBranchActive(ctx, String(fd.get("id") ?? ""), fd.get("active") === "true");
    } catch (e) {
      return { error: toMessage(e) };
    }
    revalidatePath("/", "layout");
    return { ok: true };
  });
}
