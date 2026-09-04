import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("지점장 이슈 작성 → 멘토 해결·멘션 코멘트 → 지점장 알림", async ({ page, browser }) => {
  await login(page, "manager");
  await page.goto("/counsel/weekly");
  await expect(page.getByRole("heading", { name: "주간 상담일지" })).toBeVisible();

  // 유시온(14번)은 이번 주 일지가 없다 → 마지막 열 셀은 새 작성 링크
  const row = page.getByRole("row").filter({ hasText: "유시온" });
  await row.getByRole("link").last().click();
  await expect(page).toHaveURL(/\/counsel\/entry\?/);
  await expect(page.getByRole("heading", { name: /유시온/ })).toBeVisible();

  const issueCard = page.locator("form").filter({ has: page.locator('input[name="field"][value="issue"]') });
  await issueCard.getByRole("textbox").fill("영어 단어 암기량 부족. 주 3회 테스트 필요");
  await issueCard.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/counsel\/logs\/[0-9a-f-]+$/);
  const logUrl = page.url();
  await expect(page.getByText("영어 단어 암기량 부족")).toBeVisible();
  // 지점장은 멘토 열을 편집할 수 없다
  await expect(page.locator('input[name="field"][value="resolution"]')).toHaveCount(0);

  // 멘토
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await login(p2, "mentor");
  await p2.goto(logUrl);
  const resCard = p2.locator("form").filter({ has: p2.locator('input[name="field"][value="resolution"]') });
  await resCard.getByRole("textbox").fill("단어장 2단원 테스트 실시, 30개 중 27개 통과");
  await resCard.getByRole("button", { name: "저장" }).click();
  await expect(resCard.getByText("저장됨")).toBeVisible();
  await p2.getByPlaceholder(/멘션하면/).fill("@박원장 학부모 통화 부탁드립니다");
  await p2.getByRole("button", { name: "코멘트 남기기" }).click();
  await expect(p2.getByText("@박원장 학부모 통화 부탁드립니다")).toBeVisible();
  await expect(p2.getByText("코멘트 (1)")).toBeVisible();
  await ctx2.close();

  // 지점장 화면: 해결 내용과 코멘트가 보이고 알림이 왔다
  await page.reload();
  await expect(page.getByText("단어장 2단원 테스트 실시")).toBeVisible();
  await expect(page.getByText("이멘토").first()).toBeVisible();
  await page.goto("/notifications");
  await expect(page.getByText("멘션").first()).toBeVisible();
  await expect(page.getByText("@박원장 학부모 통화 부탁드립니다")).toBeVisible();
  await page.getByRole("button", { name: "모두 읽음" }).click();
  await expect(page.getByText("읽지 않음 0건")).toBeVisible();

  // 그리드에 코멘트 수 배지와 내용이 반영된다
  await page.goto("/counsel/weekly");
  const row2 = page.getByRole("row").filter({ hasText: "유시온" });
  await expect(row2.getByText("영어 단어 암기량 부족")).toBeVisible();
  await expect(row2.getByText("단어장 2단원 테스트")).toBeVisible();
});

test("집중관리 개인 일지: 일자별 작성", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/counsel/focus");
  await expect(page.getByRole("heading", { name: "집중관리 개인 일지" })).toBeVisible();
  await page.getByRole("link", { name: /강하늘/ }).first().click();
  // 오늘 행(첫 행)은 아직 미작성
  const firstRow = page.getByRole("listitem").filter({ hasText: "원장: 미작성" }).first();
  await firstRow.getByRole("link").click();
  await expect(page).toHaveURL(/logType=focus_daily/);
  const issueCard = page.locator("form").filter({ has: page.locator('input[name="field"][value="issue"]') });
  await issueCard.getByRole("textbox").fill("오늘 플래너 미작성");
  await issueCard.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/counsel\/logs\//);
  await expect(page.getByRole("heading", { name: /집중관리 일지/ })).toBeVisible();
});

test("월별 보기 전환", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/counsel/weekly?month=2026-09");
  await expect(page.getByText("2026년 9월")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /9\/7\(월\) 주/ })).toBeVisible();
});

test("조교는 상담일지에 접근할 수 없다", async ({ page }) => {
  await login(page, "assistant");
  await page.goto("/counsel/weekly");
  await expect(page.getByText("권한이 없습니다")).toBeVisible();
});
