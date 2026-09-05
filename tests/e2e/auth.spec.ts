import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("지점장 로그인 → 대시보드 → 로그아웃", async ({ page }) => {
  await login(page, "manager");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  await expect(page.getByText("지점장 박원장")).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("잘못된 비밀번호는 오류 메시지", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("manager");
  await page.getByLabel("비밀번호").fill("wrong");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByText("아이디 또는 비밀번호가 올바르지 않습니다")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("조교는 로그인 후 라운딩 홈으로 간다", async ({ page }) => {
  await login(page, "assistant");
  await expect(page).toHaveURL("/rounding");
  await expect(page.getByRole("heading", { name: "라운딩" })).toBeVisible();
});

test("로그인 없이 보호 경로에 가면 로그인으로 보내고 next를 유지한다", async ({ page }) => {
  await page.goto("/members");
  await expect(page).toHaveURL(/\/login\?next=%2Fmembers/);
  await page.getByLabel("아이디").fill("manager");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL("/members");
});

test("본사 관리자는 지점을 전환할 수 있다", async ({ page }) => {
  await login(page, "hq");
  await page.goto("/members");
  await expect(page.getByRole("link", { name: "강하늘" })).toBeVisible();
  await page.getByLabel("지점 선택").selectOption({ label: "수원1" });
  await page.waitForURL("/");
  await page.goto("/members");
  await expect(page.getByRole("link", { name: "백서준" })).toBeVisible();
  await expect(page.getByRole("link", { name: "강하늘" })).toHaveCount(0);
});

test("비밀번호 5회 실패 시 10분 잠금", async ({ page }) => {
  await page.goto("/login");
  for (let i = 0; i < 5; i++) {
    await page.getByLabel("아이디").fill("manager2");
    await page.getByLabel("비밀번호").fill("wrong-" + i);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page.getByRole("button", { name: "로그인" })).toBeEnabled();
  }
  await expect(page.getByText(/잠겼습니다/)).toBeVisible();
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByText(/잠겼습니다/)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
