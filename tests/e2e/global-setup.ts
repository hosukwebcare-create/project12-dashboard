import { execSync } from "node:child_process";
import { E2E_DATABASE_URL } from "../../playwright.config";
import { resetDatabase } from "../../scripts/db-reset";

/** E2E 실행 전 전용 DB를 마이그레이션·앱 역할 권한·시드로 초기화한다 */
export default async function globalSetup() {
  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL };
  await resetDatabase(E2E_DATABASE_URL);
  const out = execSync("pnpm exec tsx src/db/seed.ts", { env, encoding: "utf8" });
  const m = out.match(/\/board\/([0-9a-f-]+)\?t=([0-9a-f]+)/);
  if (m) {
    process.env.E2E_BOARD_BRANCH_ID = m[1];
    process.env.E2E_BOARD_TOKEN = m[2];
  }
}
