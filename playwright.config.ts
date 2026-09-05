import { defineConfig, devices } from "@playwright/test";

export const E2E_DATABASE_URL = "postgres://localhost:5432/byeolha_e2e";
/** 앱 서버는 비superuser 역할로 접속해 RLS 정책이 실제로 적용된 상태로 E2E 를 돈다 (scripts/db-local-app-role.sql) */
export const E2E_APP_DATABASE_URL = "postgres://byeolha_app:byeolha_app@localhost:5432/byeolha_e2e";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3100",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm build && pnpm exec next start -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      DATABASE_URL: E2E_APP_DATABASE_URL,
      SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
