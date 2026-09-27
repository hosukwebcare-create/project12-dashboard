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
    await expect(page.getByText(/\/11회차/)).toBeVisible();
    await expect(page.getByRole("button", { name: "R11 열 메뉴" })).toBeVisible();
    await expect(page.getByRole("button", { name: "R12 열 메뉴" })).toHaveCount(0);

    await page.goto("/settings/branch");
    await page.getByRole("button", { name: /링크 (재)?발급/ }).click();
    const code = page.locator("code");
    await expect(code).toContainText("/board/");
    const url = (await code.textContent())!.trim();
    await page.goto(url);
    await expect(page.getByText("동탄2 생활관리 현황")).toBeVisible();
    await expect(page.getByText("강*늘")).toBeVisible();
    await expect(page.getByText(/이동금지 위반 5점/)).toBeVisible();

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

    // 라운딩 표의 벌점 펜은 지점 규칙만
    await page.goto("/rounding");
    const pens = page.getByRole("toolbar", { name: "펜" });
    await expect(pens.getByRole("button", { name: /음식물 반입/ })).toBeVisible();
    await expect(pens.getByRole("button", { name: /졸음/ })).toHaveCount(0);

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
    await expect(page.getByText("사용자 목록 (5)")).toBeVisible();
    const form = page.locator("form").filter({ has: page.getByPlaceholder("아이디") });
    await form.getByPlaceholder("아이디").fill("e2easst");
    await form.getByPlaceholder("이름").fill("이투이조교");
    await form.getByPlaceholder("비밀번호 (영문+숫자 10자)").fill("secret1234");
    await form.getByRole("button", { name: "추가" }).click();
    await expect(page.getByText("사용자 목록 (6)")).toBeVisible();
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

  test("본사 관리자 추가 후 그 계정으로 로그인", async ({ page, browser }) => {
    await login(page, "hq");
    await page.goto("/settings/users");
    const card = page.locator('[data-slot="card"]').filter({ hasText: "본사 관리자 (" });
    await expect(card.getByText("본사 관리자 (1)")).toBeVisible();

    const add = card.locator("form").first();
    await add.getByPlaceholder("아이디").fill("e2ehq");
    await add.getByPlaceholder("이름").fill("이투이본사");
    await add.getByPlaceholder("비밀번호 (영문+숫자 10자)").fill("secret1234");
    await add.getByRole("button", { name: "추가" }).click();
    await expect(card.getByText("본사 관리자 (2)")).toBeVisible();

    // 지점에 소속되지 않아도 모든 지점이 보인다
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await p2.goto("/login");
    await p2.getByLabel("아이디").fill("e2ehq");
    await p2.getByLabel("비밀번호").fill("secret1234");
    await p2.getByRole("button", { name: "로그인" }).click();
    await expect(p2).toHaveURL("/");
    await expect(p2.getByText("이투이본사").first()).toBeVisible();
    await ctx2.close();
  });

  test("비밀번호를 바꾸면 그 계정의 다른 세션이 끊긴다", async ({ page, browser }) => {
    // 조교로 먼저 로그인해 둔다
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await login(p2, "assistant");
    await expect(p2).toHaveURL("/rounding");

    // 토큰의 iat 는 초 단위라 같은 초 안에서 바꾸면 구분이 안 된다. 초를 넘긴 뒤 바꾼다
    await p2.waitForTimeout(1100);

    // 지점장이 그 계정의 비밀번호를 바꾼다
    await login(page, "manager");
    await page.goto("/settings/users");
    const row = page.locator("form").filter({ has: page.locator('input[value="assistant"]') });
    await row.getByPlaceholder("새 비밀번호").fill("changed12345");
    await row.getByRole("button", { name: "저장" }).click();
    await expect(row.getByText("저장됨")).toBeVisible();

    // 열려 있던 조교 세션은 로그인 화면으로 튕긴다
    await p2.goto("/rounding");
    await expect(p2).toHaveURL(/\/login/);
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
    // 라운딩 표에 열이 생긴다. 기본 항목(출석·라운딩)은 그대로 남는다
    await page.goto("/rounding");
    await expect(page.getByRole("button", { name: "과제 열 메뉴" })).toBeVisible();
    await expect(page.getByRole("button", { name: "R1 열 메뉴" })).toBeVisible();
    await expect(page.getByRole("button", { name: "출석 열 메뉴" })).toBeVisible();
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
