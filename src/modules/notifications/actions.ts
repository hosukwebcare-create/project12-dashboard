"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/lib/auth/ctx";
import { markAllRead } from "./repo";

export async function markAllReadAction(): Promise<void> {
  const ctx = await getCtx();
  await markAllRead(ctx);
  revalidatePath("/", "layout");
}
