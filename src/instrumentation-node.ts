import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";

/**
 * drizzle/ 폴더의 마이그레이션을 서버 기동 시 적용한다. 운영 이미지에는 drizzle-kit 이 없으므로 drizzle-orm 마이그레이터를 쓴다.
 * 이미 최신이면 아무것도 하지 않는다(스키마 생성 권한이 없는 계정에서도 조용히 지나가도록). AUTO_MIGRATE=false 로 끌 수 있다.
 */
export async function autoMigrate(): Promise<void> {
  if (process.env.AUTO_MIGRATE === "false" || !process.env.DATABASE_URL) return;
  const folder = join(process.cwd(), "drizzle");
  const journalPath = join(folder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    console.warn("[migrate] drizzle/ 폴더가 없어 자동 마이그레이션을 건너뜁니다");
    return;
  }
  try {
    const { db } = await import("@/db/client");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
    const [row] = await db.execute<{ n: string }>(sql`select count(*)::text as n from drizzle.__drizzle_migrations`).catch(() => [{ n: "-1" }]);
    const applied = Number(row?.n ?? -1);
    if (applied >= journal.entries.length) {
      console.log(`[migrate] 스키마가 최신입니다 (${applied}/${journal.entries.length})`);
      return;
    }
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db, { migrationsFolder: folder });
    console.log(`[migrate] 마이그레이션 적용 완료 (${journal.entries.length}개)`);
  } catch (e) {
    console.error("[migrate] 자동 마이그레이션 실패. 노트북에서 pnpm db:migrate 를 실행하세요", e);
  }
}
