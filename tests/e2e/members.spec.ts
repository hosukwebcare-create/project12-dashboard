import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe("회원 마스터", () => {
  test("등록 → 상세 → 수정 → 좌석 변경 → 퇴원", async ({ page }) => {
    await login(page, "manager");
    await page.goto("/members/new");
    await page.locator("#name").fill("테스트회원");
    await page.getByLabel("성별").selectOption("여");
    await page.getByLabel("생년월일").fill("2008-03-02");
    await page.getByLabel("TYPE").selectOption("재학생");
    await page.getByLabel("계열").selectOption("이과");
    await page.getByLabel("학교", { exact: true }).fill("별하고");
    await page.getByLabel("학년").fill("3");
    await page.getByLabel("라운딩 특이사항").fill("수요일 18시 학원");
    await page.getByLabel("집중관리 대상").check();
    await page.getByLabel("연락처", { exact: true }).fill("010-1234-5678");
    await page.getByLabel("학부모 이름").fill("테스트보호자");
    await page.getByLabel("관계").fill("모");
    await page.getByLabel("학부모 연락처").fill("010-8765-4321");
    await page.getByLabel("좌석", { exact: true }).selectOption({ label: "22번 (B)" });
    await page.getByLabel("등록 시작일").fill("2026-09-01");
    await page.getByLabel("등록 종료일").fill("2026-09-30");
    await page.getByRole("button", { name: "등록", exact: true }).click();

    await expect(page).toHaveURL(/\/members\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: "테스트회원" })).toBeVisible();
    await expect(page.getByText("22번 좌석")).toBeVisible();
    await expect(page.getByText("집중관리", { exact: true })).toBeVisible();
    await expect(page.getByText("테스트보호자")).toBeVisible();
    await expect(page.getByText("2026.09.01 ~ 2026.09.30").first()).toBeVisible();

    // 수정
    await page.getByRole("link", { name: "정보 수정" }).click();
    await expect(page.getByLabel("학교", { exact: true })).toHaveValue("별하고");
    await page.getByLabel("학교", { exact: true }).fill("샛별고");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page).toHaveURL(/\/members\/[0-9a-f-]+$/);
    await expect(page.getByText("샛별고")).toBeVisible();

    // 좌석 변경 (23번은 비어 있음)
    await page.getByRole("tab", { name: /좌석 · 상태/ }).click();
    await page.locator('select[name="seatId"]').selectOption({ label: "23번 (B)" });
    await page.getByRole("button", { name: "배정" }).click();
    await expect(page.getByText("좌석을 변경했습니다")).toBeVisible();
    await page.reload();
    await expect(page.getByText("23번 좌석")).toBeVisible();

    // 퇴원 → 좌석 해제
    await page.getByRole("tab", { name: /좌석 · 상태/ }).click();
    await page.locator('select[name="status"]').selectOption("withdrawn");
    await page.getByRole("button", { name: "변경", exact: true }).click();
    await expect(page.getByText("좌석 미배정")).toBeVisible();
    await expect(page.getByText("퇴원", { exact: true }).first()).toBeVisible();

    // 타임라인에 기록이 남는다
    await page.getByRole("tab", { name: /타임라인/ }).click();
    await expect(page.getByText("상태 변경")).toBeVisible();
    await expect(page.getByText("좌석 변경")).toBeVisible();
    await expect(page.getByText("회원 등록")).toBeVisible();
  });

  test("목록 검색·필터", async ({ page }) => {
    await login(page, "manager");
    await page.goto("/members?focus=1");
    await expect(page.getByRole("link", { name: "강하늘" })).toBeVisible();
    await expect(page.getByRole("link", { name: "고은별" })).toHaveCount(0);
    await page.goto("/members?q=구민재");
    await expect(page.getByRole("link", { name: "구민재" })).toBeVisible();
    await expect(page.getByRole("link", { name: "강하늘" })).toHaveCount(0);
    await page.goto("/members?status=withdrawn");
    await expect(page.getByText("퇴원").first()).toBeVisible();
  });

  test("조교에게는 연락처·학부모 정보가 보이지 않는다", async ({ page }) => {
    await login(page, "assistant");
    await page.goto("/members");
    await expect(page.getByRole("columnheader", { name: "연락처" })).toHaveCount(0);
    await expect(page.getByText(/010-0000-/)).toHaveCount(0);
    await page.getByRole("link", { name: "강하늘" }).click();
    await expect(page.getByRole("heading", { name: "강하늘" })).toBeVisible();
    await expect(page.getByText("학부모")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "정보 수정" })).toHaveCount(0);
  });

  test("중복 좌석 배정은 오류 메시지", async ({ page }) => {
    await login(page, "manager");
    await page.goto("/members?q=고은별");
    await page.getByRole("link", { name: "고은별" }).click();
    await page.getByRole("tab", { name: /좌석 · 상태/ }).click();
    // 1번 좌석은 강하늘이 사용 중이라 옵션이 비활성이다
    await expect(page.locator('select[name="seatId"] option', { hasText: /^1번/ })).toBeDisabled();
  });
});
