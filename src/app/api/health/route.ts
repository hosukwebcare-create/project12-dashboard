import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { schedulerRunning } from "@/lib/scheduler";

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
      scheduler: schedulerRunning(),
      // 어느 커밋이 떠 있는지. Railway 가 배포 시 넣어 주는 값이고, 다른 환경은 GIT_COMMIT 으로 넘긴다
      commit: (process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? "").slice(0, 7) || undefined,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, db: false, error: e instanceof Error ? e.message : "db error" }, { status: 503 });
  }
}
