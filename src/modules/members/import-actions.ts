"use server";

import { withRequestRls } from "@/lib/rls";
import { revalidatePath } from "next/cache";
import { toMessage } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { parseTable } from "@/lib/rules/csv";
import { todayKey } from "@/lib/rules/week";
import { autoMapHeaders, commitImport, previewImport, type ImportField, type ImportPreview, type ImportResult, type ImportRow } from "./import";

export type ParseResult = { data: string[][]; mapping: Record<number, ImportField | null>; error?: string };

export async function parseImportAction(text: string): Promise<ParseResult> {
  return withRequestRls(async () => {
    await getCtx();
    const data = parseTable(text);
    if (data.length < 2) return { data: [], mapping: {}, error: "헤더 행과 데이터 행이 최소 1개씩 필요합니다" };
    if (data.length > 2001) return { data: [], mapping: {}, error: "한 번에 2,000행까지 이관할 수 있습니다" };
    return { data, mapping: autoMapHeaders(data[0]) };
  });
}

export async function previewImportAction(data: string[][], mapping: Record<number, ImportField | null>): Promise<ImportPreview | { error: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      return await previewImport(ctx, data, mapping, todayKey());
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}

export async function commitImportAction(rows: ImportRow[]): Promise<ImportResult | { error: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      const r = await commitImport(ctx, rows);
      revalidatePath("/members");
      return r;
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}
