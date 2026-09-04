import { execSync } from "node:child_process";
import { E2E_DATABASE_URL } from "../../playwright.config";

/** E2E 실행 전 전용 DB를 스키마·시드로 초기화한다 */
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL };
  execSync("pnpm exec drizzle-kit push --force", { env, stdio: "pipe" });
  const out = execSync("pnpm exec tsx src/db/seed.ts", { env, encoding: "utf8" });
  const m = out.match(/\/board\/([0-9a-f-]+)\?t=([0-9a-f]+)/);
  if (m) {
    process.env.E2E_BOARD_BRANCH_ID = m[1];
    process.env.E2E_BOARD_TOKEN = m[2];
  }
}
