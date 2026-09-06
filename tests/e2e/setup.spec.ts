import { expect, test } from "@playwright/test";

test("사용자가 있으면 처음 설정 화면은 로그인으로 넘긴다", async ({ page }) => {
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
});
