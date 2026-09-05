import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe("설정", () => {
  test("지점 설정 저장과 현황판 링크 발급", async ({ page }) => {
    await login(page, "manager");
    await page.goto("/settings/branch");
    await page.getByLabel("하루 회차 수").fill("11");
    await page.getByLabel("현황판에 이름을 마스킹해서 표시 (김*민)").check();
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("저장됨")).toBeVisible();
    await page.goto("/rounding");
    await expect(page.getByText(/\/11 회차 완료/)).toBeVisible();

    await page.goto("/settings/branch");
    await page.getByRole("button", { name: /링크 (재)?발급/ }).click();
    const code = page.locator("code");
    await expect(code).toContainText("/board/");
    const url = (await code.textContent())!.trim();
    await page.goto(url);
    await expect(page.getByText("동탄2 생활관리 현황")).toBeVisible();
    await expect(page.getByText("강*늘")).toBeVisible();
    await expect(page.getByText("이동금지 위반[5점]")).toBeVisible();

    // 원복
    await page.goto("/settings/branch");
    await page.getByLabel("하루 회차 수").fill("12");
    await page.getByLabel("현황판에 이름을 마스킹해서 표시 (김*민)").uncheck();
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("저장됨")).toBeVisible();
  });

  test("벌점 규칙: 지점 규칙 추가 후 라운딩에 반영", async ({ page }) => {
    await login(page, "manager");
    await page.goto("/settings/penalty-rules");
    const form = page.locator("form").filter({ has: page.getByPlaceholder("규칙 이름") });
    await form.getByPlaceholder("규칙 이름").fill("음식물 반입");
    await form.getByPlaceholder("점수").fill("2");
    await form.getByRole("button", { name: "추가" }).click();
    await expect(page.locator('input[name="name"][value="음식물 반입"]')).toBeVisible();
    await expect(page.getByText("지점 규칙 없음")).toHaveCount(0);

    // 라운딩 시트의 규칙 목록은 지점 규칙만
    await page.goto("/rounding");
    const link = page.getByRole("link", { name: /R1/ }).first();
    await link.click();
    await page.getByRole("listitem").filter({ hasText: "강하늘" }).getByRole("button", { name: "벌점" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: /음식물 반입/ })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /졸음/ })).toHaveCount(0);
    await sheet.getByRole("button", { name: "취소" }).click();

    // 비활성화하면 다시 본사 기본 규칙
    await page.goto("/settings/penalty-rules");
    const row = page.locator("form").filter({ has: page.locator('input[name="name"][value="음식물 반입"]') });
    await row.getByLabel("사용").uncheck();
    await row.getByRole("button", { name: "저장" }).click();
    await expect(row.getByText("저장됨")).toBeVisible();
  });

  test("좌석 일괄 추가와 수정", async ({ page }) => {
    await login(page, "manager");
    await page.goto("/settings/seats");
    await expect(page.getByText("좌석 목록 (50)")).toBeVisible();
    await page.getByPlaceholder("시작").fill("51");
    await page.getByPlaceholder("끝").fill("55");
    await page.getByPlaceholder("구역 (A)").fill("D");
    await page.getByRole("button", { name: "추가" }).click();
    await expect(page.getByText("좌석 목록 (55)")).toBeVisible();
    // 다시 추가하면 건너뛴다
    await page.getByPlaceholder("시작").fill("51");
    await page.getByPlaceholder("끝").fill("55");
    await page.getByRole("button", { name: "추가" }).click();
    await expect(page.getByText("추가할 좌석이 없습니다")).toBeVisible();
  });

  test("사용자 추가 후 그 계정으로 로그인", async ({ page, browser }) => {
    await login(page, "manager");
    await page.goto("/settings/users");
    await expect(page.getByText("사용자 목록 (4)")).toBeVisible();
    const form = page.locator("form").filter({ has: page.getByPlaceholder("아이디") });
    await form.getByPlaceholder("아이디").fill("e2easst");
    await form.getByPlaceholder("이름").fill("이투이조교");
    await form.getByPlaceholder("비밀번호 (6자+)").fill("secret1234");
    await form.getByRole("button", { name: "추가" }).click();
    await expect(page.getByText("사용자 목록 (5)")).toBeVisible();
    // 지점장은 지점장 역할을 만들 수 없다
    await expect(form.locator('select[name="role"] option', { hasText: "지점장" })).toHaveCount(0);

    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await p2.goto("/login");
    await p2.getByLabel("아이디").fill("e2easst");
    await p2.getByLabel("비밀번호").fill("secret1234");
    await p2.getByRole("button", { name: "로그인" }).click();
    await expect(p2).toHaveURL("/rounding");
    await expect(p2.getByText("이투이조교")).toBeVisible();
    await ctx2.close();
  });

  test("현황판 항목 추가", async ({ page }) => {
    await login(page, "manager");
    await page.goto("/settings/board-items");
    const form = page.locator("form").filter({ has: page.getByPlaceholder("키 (영문)") });
    await form.getByPlaceholder("키 (영문)").fill("homework");
    await form.getByPlaceholder("표시 이름").fill("과제");
    await form.getByRole("button", { name: "추가" }).click();
    await expect(page.locator('input[name="key"][value="homework"]')).toBeVisible();
    // 일별 체크 탭에 나타난다 (지점 항목만 사용되므로 과제 하나)
    await page.goto("/daily-checks");
    await expect(page.getByRole("link", { name: "과제" })).toBeVisible();
    // 원복: 비활성
    await page.goto("/settings/board-items");
    const row = page.locator("form").filter({ has: page.locator('input[name="key"][value="homework"]') });
    await row.getByLabel("사용").uncheck();
    await row.getByRole("button", { name: "저장" }).click();
    await expect(row.getByText("저장됨")).toBeVisible();
  });

  test("멘토는 설정에 접근할 수 없다", async ({ page }) => {
    await login(page, "mentor");
    await page.goto("/settings/branch");
    await expect(page.getByText("권한이 없습니다")).toBeVisible();
  });
});
