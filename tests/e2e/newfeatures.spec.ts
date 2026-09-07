import { expect, test } from "@playwright/test";
import { login, todayKey } from "./helpers";

test("상담 일정: 신규 상담을 잡고 캘린더와 목록에 나타난다", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/counsel/schedule");
  await expect(page.getByRole("heading", { name: "상담 일정" })).toBeVisible();

  const form = page.locator("form").filter({ has: page.getByLabel("시작") });
  await form.getByLabel("날짜").fill(todayKey());
  await form.getByLabel("시작").fill("14:00");
  await form.getByLabel("이름").fill("이투이신규");
  await form.getByLabel("연락처").fill("010-4444-5555");
  await form.getByRole("button", { name: "추가" }).click();

  // 격자와 오른쪽 목록 양쪽에 나타난다
  await expect(page.getByText("이투이신규").first()).toBeVisible();
  await expect(page.getByText("이번 주 목록 (1)")).toBeVisible();

  // 눌러서 수정 화면으로
  await page.getByRole("link", { name: /이투이신규/ }).first().click();
  await expect(page).toHaveURL(/edit=/);
  // 수정 화면에서만 나오는 것들 (CardTitle 은 heading 이 아니라 텍스트로 찾는다)
  await expect(page.getByText("일정 수정")).toBeVisible();
  await expect(page.getByRole("link", { name: "새 일정 쓰기" })).toBeVisible();
});

test("인수인계: 남긴 글이 다른 근무자에게 안 읽음으로 보이고 읽으면 사라진다", async ({ page, browser }) => {
  await login(page, "assistant");
  await page.goto("/handover");
  const form = page.locator("form").filter({ has: page.getByPlaceholder(/스탠드 깜빡임/) });
  await form.getByPlaceholder(/스탠드 깜빡임/).fill("이투이 인수인계 확인용");
  await form.getByRole("button", { name: "남기기" }).click();
  const own = page.locator('[data-slot="card"]').filter({ hasText: "이투이 인수인계 확인용" });
  await expect(own).toBeVisible();
  // 자기 글은 안 읽음이 아니다 (설명 문구에도 '안 읽음'이 있으므로 글 카드 안에서만 본다)
  await expect(own.getByText("안 읽음")).toHaveCount(0);

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await login(p2, "manager");
  await p2.goto("/handover");
  const card = p2.locator('[data-slot="card"]').filter({ hasText: "이투이 인수인계 확인용" });
  await expect(card.getByText("안 읽음")).toBeVisible();
  await card.getByRole("button", { name: "읽음" }).click();
  await expect(card.getByText("안 읽음")).toHaveCount(0);

  // 답글이 붙는다
  await card.getByPlaceholder("답글").fill("확인했습니다");
  await card.getByRole("button", { name: "답글" }).click();
  await expect(p2.getByText("확인했습니다")).toBeVisible();
  await ctx2.close();
});

test("결제 대상: 요금표를 만들고 좌석 등급을 지정하면 금액이 계산된다", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/settings/fees");
  const planForm = page.locator("form").filter({ has: page.getByPlaceholder("등급 이름 (예: 1인실)") });
  await planForm.getByPlaceholder("등급 이름 (예: 1인실)").fill("이투이실");
  await planForm.getByPlaceholder("학생 요금").fill("333000");
  await planForm.getByPlaceholder("성인 요금").fill("444000");
  await planForm.getByRole("button", { name: "추가" }).click();
  await expect(page.locator('input[name="name"][value="이투이실"]')).toBeVisible();

  // 1~3번 좌석에 일괄 지정
  const bulk = page.locator("form").filter({ has: page.getByLabel("시작 좌석") });
  await bulk.getByLabel("시작 좌석").fill("1");
  await bulk.getByLabel("끝 좌석").fill("3");
  await bulk.getByLabel("일괄 지정할 등급").selectOption({ label: "이투이실" });
  await bulk.getByRole("button", { name: "일괄 지정" }).click();
  await expect(bulk.getByText("저장됨")).toBeVisible();

  await page.goto("/payments");
  await expect(page.getByRole("heading", { name: "결제 대상" })).toBeVisible();
  await expect(page.getByText("이투이실").first()).toBeVisible();
  await expect(page.getByText("좌석 이용료 미납")).toBeVisible();

  // 한 줄의 입력은 칸마다 흩어져 있고 form 속성으로 한 폼에 묶인다. 같이 전송되는지 확인한다.
  const row = page.locator("tbody tr").filter({ hasText: "이투이실" }).first();
  const name = (await row.locator("td").nth(1).innerText()).split("\n")[0].trim();
  await row.getByLabel(`${name} 금액`).fill("333000");
  await row.getByLabel(`${name} 할인`).fill("33000");
  await row.getByLabel(`${name} 메모`).fill("친구할인");
  await row.getByRole("button", { name: "저장" }).click();
  await expect(row.getByText("저장됨")).toBeVisible();

  await page.goto("/payments");
  const saved = page.locator("tbody tr").filter({ hasText: "이투이실" }).first();
  await expect(saved.locator("td").nth(6)).toHaveText("300,000");
  await expect(saved.getByLabel(`${name} 메모`)).toHaveValue("친구할인");

  // 표는 카드 안에서만 가로로 넘치고 페이지 자체는 가로 스크롤이 생기지 않는다
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("멘토는 결제 대상을 볼 수 없다", async ({ page }) => {
  await login(page, "mentor");
  await page.goto("/payments");
  await expect(page.getByText(/권한이 없습니다|접근할 수 없습니다/)).toBeVisible();
});
