import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("모의고사 회차 생성 → 신청·결제 기록 → 집계", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/mock-exams");
  await page.getByLabel("회차 월").fill("2026-10");
  await page.getByPlaceholder(/회차 이름/).fill("E2E 모의고사");
  await page.getByLabel("응시료").fill("29000");
  await page.getByRole("button", { name: "회차 만들기" }).click();
  await expect(page).toHaveURL(/\/mock-exams\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: /E2E 모의고사/ })).toBeVisible();
  await expect(page.getByText("0명", { exact: true })).toBeVisible();

  const row = page.locator("form").filter({ has: page.getByRole("link", { name: "강하늘" }) });
  await row.getByLabel("신청").check();
  await row.getByLabel("계열").selectOption("문과");
  await row.getByPlaceholder("과목 조합").fill("화작·확통·세지·사문");
  await row.getByLabel("결제일").fill("2026-09-05");
  await row.getByRole("button", { name: "저장" }).click();
  await expect(row.getByText("저장됨")).toBeVisible();
  await page.reload();
  await expect(page.getByText("1명", { exact: true })).toBeVisible();
  await expect(page.getByText("1 / 0")).toBeVisible();
  await expect(page.getByText("문과 1")).toBeVisible();
  await expect(page.getByText("29,000 / 29,000원")).toBeVisible();

  await page.goto("/mock-exams");
  await expect(page.getByRole("link", { name: /E2E 모의고사/ })).toContainText("신청 1명");
});

test("멘토는 모의고사를 볼 수 있지만 편집 폼이 없다", async ({ page }) => {
  await login(page, "mentor");
  await page.goto("/mock-exams");
  await expect(page.getByRole("button", { name: "회차 만들기" })).toHaveCount(0);
});
