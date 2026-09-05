/**
 * 테스트·E2E DB 초기화: public 스키마를 지우고 drizzle/ 마이그레이션을 처음부터 적용한 뒤
 * 비superuser 앱 역할(byeolha_app)에 권한을 준다. drizzle-kit push 는 RLS 정책의 USING 식을 반영하지 않으므로 쓰지 않는다.
 *   pnpm exec tsx scripts/db-reset.ts postgres://localhost:5432/byeolha_test
 */
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function resetDatabase(url: string): Promise<void> {
  if (!/byeolha_(test|e2e|perf)/.test(url)) throw new Error(`테스트용 DB 만 초기화할 수 있습니다: ${url}`);
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
    await sql.unsafe(readFileSync("scripts/db-local-app-role.sql", "utf8"));
  } finally {
    await sql.end();
  }
}

const isMain = process.argv[1]?.endsWith("db-reset.ts");
if (isMain) {
  const url = process.argv[2] ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DB URL 을 인자나 DATABASE_URL 로 주세요");
  resetDatabase(url).then(() => console.log(`초기화 완료: ${url}`));
}
