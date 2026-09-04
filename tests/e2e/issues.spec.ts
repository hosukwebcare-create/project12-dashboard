import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("이슈 등록 → 코멘트 → 담당 지정 → 해결", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/issues/new");
  await page.getByLabel("회원 (선택)").selectOption({ label: "2번 · 고은별" });
  await page.getByLabel("제목").fill("E2E 테스트 이슈");
  await page.getByLabel("내용").fill("라운딩 중 반복 확인");
  await page.getByLabel("심각도").selectOption("high");
  await page.getByRole("button", { name: "이슈 등록" }).click();
  await expect(page).toHaveURL(/\/issues\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "E2E 테스트 이슈" })).toBeVisible();
  await expect(page.getByText("높음")).toBeVisible();

  await page.getByPlaceholder(/코멘트를 남기면/).fill("확인 후 학부모 안내 예정");
  await page.getByRole("button", { name: "코멘트 남기기" }).click();
  await expect(page.getByText("확인 후 학부모 안내 예정")).toBeVisible();
  await expect(page.getByText("코멘트 (1)")).toBeVisible();

  await page.locator('select[name="assignedTo"]').selectOption({ label: "이멘토" });
  await page.getByRole("button", { name: "지정" }).click();
  await expect(page.getByText("담당 이멘토")).toBeVisible();

  await page.getByRole("button", { name: "처리 중" }).click();
  await expect(page.getByText("처리 중", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "해결", exact: true }).click();
  await expect(page.getByText(/해결 20\d\d\./)).toBeVisible();

  await page.goto("/issues?status=resolved");
  await expect(page.getByText("E2E 테스트 이슈")).toBeVisible();
  await page.goto("/issues?status=open");
  await expect(page.getByText("E2E 테스트 이슈")).toHaveCount(0);
});

test("조교가 만든 이슈는 지점장에게 알림이 간다", async ({ page, browser }) => {
  await login(page, "assistant");
  await page.goto("/issues/new");
  await page.getByLabel("제목").fill("정수기 고장");
  await page.getByRole("button", { name: "이슈 등록" }).click();
  await expect(page).toHaveURL(/\/issues\/[0-9a-f-]+$/);
  // 조교에게는 처리 패널이 없다
  await expect(page.getByRole("button", { name: "해결", exact: true })).toHaveCount(0);

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await login(p2, "manager");
  await p2.goto("/notifications");
  await expect(p2.getByText("정수기 고장")).toBeVisible();
  await ctx2.close();
});
