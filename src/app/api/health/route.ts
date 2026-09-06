import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/** 업타임 체크·Cloud Run 헬스체크용. DB 연결까지 확인한다 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await db.execute(sql`select 1`);
    // localTime 은 시간대 설정을 눈으로 확인하려고 넣었다. 서버가 UTC 로 돌면 화면의 '오늘'이 하루 어긋난다.
    const now = new Date();
    return NextResponse.json({
      ok: true,
      db: true,
      latencyMs: Date.now() - startedAt,
      time: now.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      localTime: now.toLocaleString("sv-SE"),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, db: false, error: e instanceof Error ? e.message : "db error" }, { status: 503 });
  }
}
