import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("조교: 회차 입력(빠른 탭·벌점 시트·이슈) → 완료 → 다음 회차", async ({ page }) => {
  await login(page, "assistant");
  await expect(page).toHaveURL("/rounding");

  // 진행 중 회차가 있으면 이어서, 없으면 새로 시작
  const resume = page.getByRole("link", { name: /진행 중 · 이어서 입력/ });
  if (await resume.count()) await resume.click();
  else await page.getByRole("button", { name: /R\d+ 시작/ }).click();
  await expect(page).toHaveURL(/\/rounding\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: /R\d+ 라운딩/ })).toBeVisible();
  const roundNo = Number((await page.getByRole("heading", { name: /R\d+ 라운딩/ }).textContent())!.match(/R(\d+)/)![1]);

  // 빠른 탭: 고은별 → b
  const row = page.getByRole("listitem").filter({ hasText: "고은별" });
  await row.getByRole("button", { name: "b", exact: true }).click();
  await expect(row.getByRole("button", { name: "b", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "고은별" }).getByRole("button", { name: "b", exact: true })).toHaveAttribute("aria-pressed", "true");

  // 벌점 시트: 구민재 → 지각 + 메모 + 이슈
  const row2 = page.getByRole("listitem").filter({ hasText: "구민재" });
  // exact: 오늘 이미 벌점이 있으면 행 버튼 본문에도 '벌점' 이 들어가 두 개가 잡힌다
  await row2.getByRole("button", { name: "벌점", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("구민재");
  await sheet.getByRole("button", { name: /지각/ }).click();
  await sheet.getByLabel("메모").fill("10분 지각");
  await sheet.getByLabel("지점장에게 이슈로 보고").check();
  await sheet.getByRole("button", { name: "저장" }).click();
  await expect(row2.getByText(/지각 4점 · 이슈/)).toBeVisible();
  await expect(row2.getByRole("button", { name: "4", exact: true })).toHaveAttribute("aria-pressed", "true");

  // 검색
  await page.getByPlaceholder("이름 또는 좌석번호").fill("나윤서");
  await expect(page.getByRole("listitem").filter({ hasText: "나윤서" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "고은별" })).toHaveCount(0);
  await page.getByPlaceholder("이름 또는 좌석번호").fill("");

  // 완료
  await page.getByRole("button", { name: /회차 완료/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`R${roundNo} 회차 완료`);
  await expect(dialog).toContainText("이슈 보고");
  await dialog.getByRole("button", { name: "조교 홈으로" }).click();
  await expect(page).toHaveURL("/rounding");
  await expect(page.getByRole("button", { name: new RegExp(`R${roundNo + 1} 시작`) })).toBeVisible();

  // 조회 화면에 반영
  await page.goto("/rounding/history");
  const hrow = page.getByRole("row").filter({ hasText: "구민재" });
  await expect(hrow).toContainText("4");
});

test("이슈 보고는 지점장 이슈함·알림에 도달한다", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/issues");
  await expect(page.getByText(/구민재 · 지각/)).toBeVisible();
  await page.goto("/notifications");
  await expect(page.getByText(/구민재 · 지각/)).toBeVisible();
});

test("일별 체크: 출석에 등원 시각·CALL 기록", async ({ page }) => {
  await login(page, "assistant");
  await page.goto("/daily-checks");
  await expect(page.getByRole("heading", { name: "일별 체크" })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "도현우" });
  await row.getByRole("button", { name: "부재" }).click();
  await expect(row.getByRole("button", { name: "부재" })).toHaveAttribute("aria-pressed", "true");
  // 시트에서 등원 시각
  await row.getByText("도현우").click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "b", exact: true }).click();
  await sheet.getByLabel("등원 시각").fill("09:40");
  await sheet.getByLabel("전화 확인(CALL)").check();
  await sheet.getByRole("button", { name: "저장" }).click();
  await expect(row.getByRole("button", { name: "b", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page.getByRole("listitem").filter({ hasText: "도현우" }).getByText("도현우").click();
  await expect(page.getByRole("dialog").getByLabel("등원 시각")).toHaveValue("09:40");
});

test("라운딩을 돌면서 일별 항목도 같은 줄에서 적고, 나머지는 한 번에 a로 채운다", async ({ page }) => {
  await login(page, "assistant");
  const resume = page.getByRole("link", { name: /진행 중 · 이어서 입력/ });
  if (await resume.count()) await resume.click();
  else await page.getByRole("button", { name: /R\d+ 시작/ }).click();
  await expect(page.getByRole("heading", { name: /R\d+ 라운딩/ })).toBeVisible();

  // 같은 줄의 '플래너' 칩을 한 번 누르면 a. 시드에 이미 적힌 학생이 있으므로 비어 있는 첫 학생을 고른다
  const emptyChip = page.getByRole("button", { name: /플래너 미입력$/ }).first();
  const who = (await emptyChip.getAttribute("aria-label"))!.replace(/ 플래너 미입력$/, "");
  const row = page.getByRole("listitem").filter({ hasText: who });
  await emptyChip.click();
  await expect(row.getByRole("button", { name: `${who} 플래너 a` })).toBeVisible();
  // 이미 적힌 칩을 누르면 그 항목의 편집 시트가 열린다
  await row.getByRole("button", { name: `${who} 플래너 a` }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("플래너");
  await sheet.getByRole("button", { name: "b", exact: true }).click();
  await sheet.getByRole("button", { name: "저장" }).click();
  await expect(row.getByRole("button", { name: `${who} 플래너 b` })).toBeVisible();

  // 일별 체크에 그대로 들어가 있다 — 다시 돌 필요가 없다
  await page.goto("/daily-checks?item=planner");
  const drow = page.getByRole("listitem").filter({ hasText: who });
  await expect(drow.getByRole("button", { name: "b", exact: true })).toHaveAttribute("aria-pressed", "true");

  // 예외만 적고 나머지는 한 번에
  await page.getByRole("button", { name: /미입력 \d+명을 a로 채우기/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "a로 채우기" }).click();
  await expect(page.getByRole("button", { name: /미입력 \d+명을 a로 채우기/ })).toHaveCount(0);
  await page.reload();
  // 다시 읽어도 채울 사람이 남아 있지 않다 (버튼은 일부만 적혔을 때만 나온다)
  await expect(page.getByRole("heading", { name: "일별 체크" })).toBeVisible();
  await expect(page.getByRole("button", { name: /미입력 \d+명을 a로 채우기/ })).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: who }).getByRole("button", { name: "b", exact: true })).toHaveAttribute("aria-pressed", "true");

  // 출석은 한꺼번에 채울 수 없다 (결석이 출석으로 바뀌면 안 된다)
  await page.goto("/daily-checks?item=attendance");
  await expect(page.getByRole("button", { name: /a로 채우기/ })).toHaveCount(0);
});

test("멘토는 라운딩 시트를 읽기만 한다", async ({ page }) => {
  await login(page, "mentor");
  await page.goto("/rounding");
  const link = page.getByRole("link", { name: /R1/ }).first();
  await link.click();
  await expect(page.getByRole("heading", { name: /R1 라운딩/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "벌점" })).toHaveCount(0);
});
