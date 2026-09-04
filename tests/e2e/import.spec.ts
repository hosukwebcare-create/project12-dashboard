import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("CSV 이관: 붙여넣기 → 매핑 확인 → 검증 → 반영", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/members/import");
  await expect(page.getByRole("heading", { name: "회원 CSV 이관" })).toBeVisible();

  const tsv = [
    ["좌석번호", "성명", "연락처", "생년월일", "성별", "구분", "TYPE", "집중관리", "학교명/학년", "계열", "학부모 연락처", "등록기간"].join("\t"),
    ["24", "이관회원A", "010.7777.1111", "2008/05/06", "여", "학생", "재학생", "O", "별하고2", "문과", "010-7777-2222", "2026-09-01 ~ 2026-09-30"].join("\t"),
    ["25", "이관회원B/S", "", "", "남", "", "N수생", "", "", "이과", "", "7월16~8월17일[33일]"].join("\t"),
    ["999", "이관회원C", "", "", "", "", "", "", "", "", "", ""].join("\t"),
  ].join("\n");
  await page.getByRole("textbox").fill(tsv);
  await page.getByRole("button", { name: "미리보기" }).click();

  await expect(page.getByText(/총 3행 · 반영 가능 2행 · 오류 1건/)).toBeVisible();
  await expect(page.getByText("999번 좌석이 지점에 없습니다")).toBeVisible();
  const rowA = page.getByRole("row").filter({ hasText: "이관회원A" });
  await expect(rowA).toContainText("010-7777-1111");
  await expect(rowA).toContainText("별하고 2");
  await expect(rowA).toContainText("O");
  const rowB = page.getByRole("row").filter({ hasText: "이관회원B" });
  await expect(rowB).toContainText("2026-07-16 ~ 2026-08-17 (단기)");

  await page.getByRole("button", { name: "2행 반영" }).click();
  await expect(page.getByText("이관 완료")).toBeVisible();
  await expect(page.getByText("새로 등록 2명, 기존 갱신 0명")).toBeVisible();

  await page.goto("/members?q=이관회원");
  await expect(page.getByRole("link", { name: "이관회원A" })).toBeVisible();
  await expect(page.getByRole("link", { name: "이관회원B" })).toBeVisible();
  await page.getByRole("link", { name: "이관회원A" }).click();
  await expect(page.getByText("24번 좌석")).toBeVisible();
  await expect(page.getByText("010-7777-2222")).toBeVisible();
  await expect(page.getByText("집중관리", { exact: true })).toBeVisible();
});
