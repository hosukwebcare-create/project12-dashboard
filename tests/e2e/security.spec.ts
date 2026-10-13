import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("로그아웃하면 그 쿠키를 복사해 둔 다른 브라우저도 더는 못 쓴다", async ({ page, browser }) => {
  await login(page, "manager");
  const stolen = await page.context().cookies();
  const other = await browser.newContext();
  await other.addCookies(stolen);
  const thief = await other.newPage();
  await thief.goto("/members");
  await expect(thief).toHaveURL(/\/members$/);

  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);

  await thief.goto("/members");
  await expect(thief).toHaveURL(/\/login/);
  await other.close();
});

test("로그인 뒤 이동 주소로 다른 사이트에 보낼 수 없다", async ({ page }) => {
  await page.goto(`/login?next=${encodeURIComponent("/\\evil.example")}`);
  await page.getByLabel("아이디").fill("manager");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL("http://localhost:3100/");
});

test("새 직원이 내 계정에서 비밀번호를 바꾸면 예전 비밀번호로는 못 들어오고, 로그인 기록이 본사 보안 기록에 남는다", async ({ page }) => {
  // 본사가 새 조교 계정을 만든다. 다른 E2E 가 동탄2 사용자 수를 세므로 수원1 에 만든다
  await login(page, "hq");
  await page.getByLabel("지점 선택").selectOption({ label: "수원1" });
  await page.waitForURL("/");
  await page.goto("/settings/users");
  const create = page.locator("form").filter({ has: page.getByPlaceholder("비밀번호 (영문+숫자 10자)") }).first();
  await create.getByPlaceholder("아이디").fill("sectest");
  await create.getByPlaceholder("이름").fill("보안시험");
  await create.getByPlaceholder("비밀번호 (영문+숫자 10자)").fill("FirstPass123");
  await create.getByRole("button", { name: "추가" }).click();
  await expect(page.getByText("보안시험").or(page.locator('input[value="보안시험"]')).first()).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();

  // 본인이 들어와 내 계정에서 비밀번호를 바꾼다
  await page.getByLabel("아이디").fill("sectest");
  await page.getByLabel("비밀번호").fill("FirstPass123");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL("/rounding");
  await page.getByRole("link", { name: /보안시험/ }).click();
  await expect(page).toHaveURL("/account");
  await expect(page.getByText("이 기기", { exact: true })).toBeVisible();
  await page.getByLabel("지금 비밀번호").fill("FirstPass123");
  await page.getByLabel("새 비밀번호", { exact: true }).fill("SecondPass456");
  await page.getByLabel("새 비밀번호 확인").fill("SecondPass456");
  await page.getByRole("button", { name: "비밀번호 바꾸기" }).click();
  await expect(page.getByRole("button", { name: "저장됨" })).toBeVisible();
  // 바꾼 뒤에도 이 기기는 계속 로그인돼 있다
  await page.goto("/account");
  await expect(page.getByText("이 기기", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();

  await page.getByLabel("아이디").fill("sectest");
  await page.getByLabel("비밀번호").fill("FirstPass123");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByText("아이디 또는 비밀번호가 올바르지 않습니다")).toBeVisible();
  // 실패하면 폼이 비워진다
  await page.getByLabel("아이디").fill("sectest");
  await page.getByLabel("비밀번호").fill("SecondPass456");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL("/rounding");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();

  // 본사 보안 기록: 비밀번호 변경과 실패가 보인다
  await login(page, "hq");
  await page.goto("/settings/security");
  await expect(page.getByRole("cell", { name: "비밀번호 변경" }).first()).toBeVisible();
  await page.getByRole("link", { name: "실패·잠김만 보기" }).click();
  await expect(page.getByRole("cell", { name: "로그인 실패" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "비밀번호 변경" })).toHaveCount(0);
});

test("지점장은 보안 기록을 볼 수 없다", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/settings/users");
  await expect(page.getByRole("link", { name: "보안 기록" })).toHaveCount(0);
  await page.goto("/settings/security");
  await expect(page.getByText(/권한이 없습니다|접근 권한/).first()).toBeVisible();
});

test("응답 헤더: 프레임워크 이름을 숨기고, 상태 점검은 DB 오류 원문 없이 RLS 상태를 알려 준다", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
  expect(res.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  const health = await (await request.get("/api/health")).json();
  // E2E 서버는 비superuser 역할(byeolha_app)로 접속한다
  expect(health.rls).toBe(true);
});
