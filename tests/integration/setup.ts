import { sql as raw } from "drizzle-orm";
import { db } from "@/db/client";

/** 테스트 DB의 public 스키마 테이블을 모두 비운다. 마이그레이션 메타(drizzle 스키마)는 건드리지 않는다. */
export async function resetDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("byeolha_test")) {
    throw new Error(`테스트 DB가 아닙니다: ${url}`);
  }
  const rows = await db.execute<{ tablename: string }>(
    raw`select tablename from pg_tables where schemaname = 'public'`,
  );
  const names = rows.map((r) => `"${r.tablename}"`);
  if (names.length === 0) return;
  await db.execute(raw.raw(`truncate table ${names.join(", ")} restart identity cascade`));
}
