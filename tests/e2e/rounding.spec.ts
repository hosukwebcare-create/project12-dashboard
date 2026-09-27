import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/** 라운딩 하루 표의 칸. 이름·열·값이 접근성 이름에 다 들어 있다 */
const cell = (page: Page, name: string, col: string) => page.getByRole("button", { name: new RegExp(`^${name} ${col} `) });
const pen = (page: Page, label: string | RegExp) => page.getByRole("toolbar", { name: "펜" }).getByRole("button", { name: label });

test.describe("태블릿", () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

  test("조교: 펜을 고르고 칸을 누르기만 해서 적는다 — 벌점도 규칙 펜 하나로, 되돌리기까지", async ({ page }) => {
    await login(page, "assistant");
    await expect(page).toHaveURL("/rounding");
    await expect(page.getByRole("heading", { name: "라운딩" })).toBeVisible();
    // 시드: 오늘 R1·R2 완료, R3 진행 중(아직 빈 칸)
    await expect(page.getByRole("button", { name: "R3 열 메뉴" })).toBeVisible();

    // b 펜 → 고은별 R3
    await pen(page, "b").click();
    await cell(page, "고은별", "R3").click();
    await expect(cell(page, "고은별", "R3")).toHaveAccessibleName("고은별 R3 b");
    await page.reload();
    await expect(cell(page, "고은별", "R3")).toHaveAccessibleName("고은별 R3 b");

    // 지각 펜 → 구민재 R3 : 사유 고르는 창 없이 4점
    await pen(page, /^지각/).click();
    await cell(page, "구민재", "R3").click();
    await expect(cell(page, "구민재", "R3")).toHaveAccessibleName("구민재 R3 지각 4점");

    // 메모는 '메모·자세히' 펜으로 (PC 에서 적는 것)
    await pen(page, "메모·자세히").click();
    await cell(page, "구민재", "R3").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("구민재");
    await sheet.getByLabel("메모").fill("10분 지각");
    await sheet.getByLabel("지점장에게 이슈로 보고").check();
    await sheet.getByRole("button", { name: "저장" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(cell(page, "구민재", "R3")).toHaveAccessibleName("구민재 R3 지각 4점");

    // 잘못 눌렀으면 되돌리기
    await pen(page, "a").click();
    await cell(page, "나윤서", "R3").click();
    await expect(cell(page, "나윤서", "R3")).toHaveAccessibleName("나윤서 R3 a");
    await page.getByRole("button", { name: "되돌리기" }).click();
    await expect(cell(page, "나윤서", "R3")).toHaveAccessibleName("나윤서 R3 빈 칸");

    // 지우개
    await pen(page, "지우개").click();
    await cell(page, "고은별", "R3").click();
    await expect(cell(page, "고은별", "R3")).toHaveAccessibleName("고은별 R3 빈 칸");
  });

  test("직전 회차 값을 가져와 달라진 학생만 고치고, 회차를 완료한다", async ({ page }) => {
    await login(page, "assistant");
    // R3 에 몇 칸 적어 둔다
    await pen(page, "b").click();
    await cell(page, "강하늘", "R3").click();
    await expect(cell(page, "강하늘", "R3")).toHaveAccessibleName("강하늘 R3 b");

    // R4 ← R3 가져오기: 적어 둔 b 가 넘어온다
    await page.getByRole("button", { name: "R4 열 메뉴" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /R3 값 가져오기/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "가져오기" }).click();
    await expect(page.getByRole("status")).toContainText("R3 값을 R4에");
    await expect(cell(page, "강하늘", "R4")).toHaveAccessibleName("강하늘 R4 b");
    // 벌점은 옮기지 않는다: 앞 테스트에서 R3 지각을 받은 구민재는 R4 에서 a
    await expect(cell(page, "구민재", "R4")).toHaveAccessibleName("구민재 R4 a");

    // 완료: 빈 칸은 a
    await page.getByRole("button", { name: "R4 열 메뉴" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /R4 완료/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "완료" }).click();
    await expect(page.getByRole("status")).toContainText("R4 완료");
    await expect(page.getByRole("button", { name: "R4 열 메뉴" })).toContainText("완료");
  });

  test("일별 항목도 같은 표에서 적고, 빈 칸은 한 번에 a — 출석은 적지 않는다", async ({ page }) => {
    await login(page, "assistant");
    // 시드: 오늘 뒤쪽 학생 몇 명은 플래너가 비어 있다
    const empty = page.getByRole("button", { name: /^\S+ 플래너 빈 칸$/ }).first();
    const who = (await empty.getAttribute("aria-label"))!.replace(/ 플래너 빈 칸$/, "");
    await page.getByRole("button", { name: "플래너 열 메뉴" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /빈 칸 \d+칸을 a로 채우기/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "a로 채우기" }).click();
    await expect(cell(page, who, "플래너")).toHaveAccessibleName(`${who} 플래너 a`);
    await expect(page.getByRole("button", { name: /플래너 빈 칸$/ })).toHaveCount(0);

    // 출석 열은 누를 칸이 없다 (라운딩에서 저절로)
    await expect(page.getByRole("button", { name: /^\S+ 출석 / })).toHaveCount(0);
    await page.getByRole("button", { name: "출석 열 메뉴" }).click();
    await expect(page.getByRole("dialog")).toContainText("저절로 채워집니다");
  });

  test("인쇄하면 도구는 숨고 표와 머리글만 나온다", async ({ page }) => {
    await login(page, "assistant");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("toolbar", { name: "펜" })).toBeHidden();
    await expect(page.getByText(/라운딩 표 · \d{4}-\d{2}-\d{2}/)).toBeVisible();
    await expect(page.getByRole("button", { name: "R1 열 메뉴" })).toBeVisible();
    await page.emulateMedia({ media: "screen" });
  });
});

test("이슈 보고는 지점장 이슈함·알림에 도달한다", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/issues");
  await expect(page.getByText(/구민재 · 지각/)).toBeVisible();
  await page.goto("/notifications");
  await expect(page.getByText(/구민재 · 지각/)).toBeVisible();
});

test("PC: 시트처럼 화살표와 글쇠 하나로 적고 아래 칸으로 내려간다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "manager");
  await page.goto("/rounding");
  await pen(page, "a").click();
  await cell(page, "강하늘", "R5").click();
  await expect(cell(page, "강하늘", "R5")).toHaveAccessibleName("강하늘 R5 a");
  // 커서가 강하늘 R5 에 있다: B 는 그 칸을 b 로 고치고 다음 줄로
  await page.keyboard.press("KeyB");
  await expect(cell(page, "강하늘", "R5")).toHaveAccessibleName("강하늘 R5 b");
  await page.keyboard.press("Digit0");
  const next = page.locator("tbody tr").filter({ has: page.getByRole("button", { name: /R5 부재$/ }) });
  await expect(next).toHaveCount(1);
  // 잘못 적은 칸은 Delete
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Delete");
  await expect(page.getByRole("button", { name: /R5 부재$/ })).toHaveCount(0);
});

test("예전 주소(일별 체크·라운딩 조회)는 하루 표로 넘어간다", async ({ page }) => {
  await login(page, "assistant");
  await page.goto("/daily-checks");
  await expect(page).toHaveURL("/rounding");
  await page.goto("/rounding/history");
  await expect(page).toHaveURL("/rounding");
  // 메뉴에 '일별 체크'가 따로 없다
  await expect(page.getByRole("link", { name: "일별 체크" })).toHaveCount(0);
});

test("멘토는 라운딩 표를 읽기만 한다", async ({ page }) => {
  await login(page, "mentor");
  await page.goto("/rounding");
  await expect(page.getByRole("heading", { name: "라운딩" })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "펜" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^\S+ R1 / })).toHaveCount(0);
  await expect(page.getByText("읽기 전용")).toBeVisible();
});
