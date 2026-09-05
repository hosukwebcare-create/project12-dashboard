import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe("지점 관리 · 헬스체크", () => {
  test("헬스체크는 로그인 없이 DB 연결까지 확인한다", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  test("본사 관리자가 지점을 만들고 첫 지점장으로 로그인한다", async ({ page, browser }) => {
    await login(page, "hq");
    await page.goto("/settings/branches");
    await expect(page.getByText(/지점 목록 \(\d+\)/)).toBeVisible();
    await page.getByPlaceholder("코드 (예: DT3)").fill("e2e9");
    await page.getByPlaceholder("지점 이름").fill("E2E지점");
    await page.getByLabel("좌석 수").fill("12");
    await page.getByPlaceholder("지점장 아이디 (선택)").fill("e2emgr");
    await page.getByPlaceholder("지점장 이름").fill("E2E지점장");
    await page.getByPlaceholder("비밀번호 (10자+, 영문·숫자)").fill("short1");
    await page.getByRole("button", { name: "지점 만들기" }).click();
    await expect(page.getByText(/10자 이상/)).toBeVisible();

    await page.getByPlaceholder("비밀번호 (10자+, 영문·숫자)").fill("e2epassword12");
    await page.getByRole("button", { name: "지점 만들기" }).click();
    await expect(page.locator('input[name="code"][value="E2E9"]')).toBeVisible();
    await expect(page.getByText(/좌석 12 · 등록 회원 0 · 회차 12 · 지점장 E2E지점장/)).toBeVisible();

    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.goto("/login");
    await p2.getByLabel("아이디").fill("e2emgr");
    await p2.getByLabel("비밀번호").fill("e2epassword12");
    await p2.getByRole("button", { name: "로그인" }).click();
    await expect(p2).toHaveURL("/");
    await expect(p2.getByText("E2E지점").first()).toBeVisible();
    await ctx.close();
  });

  test("지점장은 지점 관리 화면에 들어갈 수 없다", async ({ page }) => {
    await login(page, "manager");
    await page.goto("/settings/branches");
    await expect(page.getByText(/권한이 없/)).toBeVisible();
  });
});
