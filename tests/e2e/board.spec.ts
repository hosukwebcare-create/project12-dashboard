import { expect, test } from "@playwright/test";

test("현황판 API는 토큰 없이는 401", async ({ request }) => {
  const branchId = process.env.E2E_BOARD_BRANCH_ID!;
  const res = await request.get(`/api/board/${branchId}`);
  expect(res.status()).toBe(401);
  const bad = await request.get(`/api/board/${branchId}?t=wrong`);
  expect(bad.status()).toBe(401);
});

test("현황판 API는 토큰이 맞으면 개인정보 없는 데이터를 준다", async ({ request }) => {
  const branchId = process.env.E2E_BOARD_BRANCH_ID!;
  const token = process.env.E2E_BOARD_TOKEN!;
  const res = await request.get(`/api/board/${branchId}?t=${token}`);
  expect(res.status()).toBe(200);
  const data = await res.json();
  expect(data.branchName).toBe("동탄2");
  expect(data.seats.length).toBeGreaterThan(10);
  expect(data.items.map((i: { key: string }) => i.key)).toContain("round");
  expect(JSON.stringify(data)).not.toContain("010-0000");
});

test("현황판 페이지는 로그인 없이 열리고 그리드를 그린다", async ({ page }) => {
  const branchId = process.env.E2E_BOARD_BRANCH_ID!;
  const token = process.env.E2E_BOARD_TOKEN!;
  await page.goto(`/board/${branchId}?t=${token}`);
  await expect(page.getByText("동탄2 생활관리 현황")).toBeVisible();
  await expect(page.getByText("벌점 합계")).toBeVisible();
  await expect(page.getByRole("cell", { name: "R1", exact: true }).first()).toBeVisible();
  await page.goto(`/board/${branchId}?t=nope`);
  await expect(page.getByText("토큰이 올바르지 않습니다")).toBeVisible();
});
