import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("공용 태블릿: PIN으로 다른 조교로 전환", async ({ page }) => {
  await login(page, "assistant");
  await expect(page.locator("header").getByText("최조교")).toBeVisible();
  await page.getByRole("link", { name: "전환" }).click();
  await expect(page).toHaveURL("/switch");
  await page.getByRole("button", { name: /정조교/ }).click();
  await page.getByLabel("PIN").fill("0000");
  await page.getByRole("button", { name: "전환" }).click();
  await expect(page.getByText("PIN이 올바르지 않습니다")).toBeVisible();

  await page.getByLabel("PIN").fill("2222");
  await page.getByRole("button", { name: "전환" }).click();
  await expect(page).toHaveURL("/rounding");
  await expect(page.locator("header").getByText("정조교")).toBeVisible();
  await expect(page.locator("header").getByText("최조교")).toHaveCount(0);
});
