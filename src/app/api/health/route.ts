import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/** 업타임 체크·Cloud Run 헬스체크용. DB 연결까지 확인한다 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: true, latencyMs: Date.now() - startedAt, time: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, db: false, error: e instanceof Error ? e.message : "db error" }, { status: 503 });
  }
}
