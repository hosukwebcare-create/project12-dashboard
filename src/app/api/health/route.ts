import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { dbRoleStatus } from "@/lib/db-role";
import { schedulerRunning } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

let journalCount: number | null = null;
async function schemaStatus(): Promise<string | null> {
  try {
    if (journalCount === null) {
      const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: unknown[] };
      journalCount = journal.entries.length;
    }
    const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    return `${row?.n ?? 0}/${journalCount}`;
  } catch {
    return null;
  }
}

/** 업타임 체크·Cloud Run 헬스체크용. DB 연결까지 확인한다 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await db.execute(sql`select 1`);
    const latencyMs = Date.now() - startedAt;
    // rls: DB 계정이 지점 격리를 지키는가(superuser·BYPASSRLS 가 아닌가). false 면 운영 설정을 고쳐야 한다
    const rls = await dbRoleStatus()
      .then((s) => s.safe)
      .catch(() => null);
    // schema: 적용된 마이그레이션 수/코드에 있는 수. 다르면 기동 때 자동 마이그레이션이 실패한 것이다(서버 로그 [migrate])
    const schema = await schemaStatus();
    // localTime 은 시간대 설정을 눈으로 확인하려고 넣었다. 서버가 UTC 로 돌면 화면의 '오늘'이 하루 어긋난다.
    const now = new Date();
    return NextResponse.json({
      ok: true,
      db: true,
      latencyMs,
      rls,
      schema,
      time: now.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      localTime: now.toLocaleString("sv-SE"),
      scheduler: schedulerRunning(),
      // 어느 커밋이 떠 있는지. Railway 가 배포 시 넣어 주는 값이고, 다른 환경은 GIT_COMMIT 으로 넘긴다
      commit: (process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? "").slice(0, 7) || undefined,
    });
  } catch (e) {
    // 오류 원문(접속 주소·계정 이름이 섞일 수 있다)은 밖으로 내보내지 않고 서버 로그에만 남긴다
    console.error("[health] DB 확인 실패", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, db: false }, { status: 503 });
  }
}
