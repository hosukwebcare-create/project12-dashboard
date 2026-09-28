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

    // 두 번 눌러도 자세히 창이 열리지 않는다(펜 값만 적힌다)
    await pen(page, "b").click();
    await cell(page, "고은별", "R3").dblclick();
    await expect(cell(page, "고은별", "R3")).toHaveAccessibleName("고은별 R3 b");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await pen(page, "지우개").click();
    await cell(page, "고은별", "R3").click();
    await expect(cell(page, "고은별", "R3")).toHaveAccessibleName("고은별 R3 빈 칸");
  });

  test("태블릿에서 펜으로 등급만 바꿔도 PC 에서 적은 메모는 남는다", async ({ page }) => {
    await login(page, "assistant");
    // 구민재 R3: 앞 테스트에서 PC(자세히 창)로 메모 '10분 지각'과 이슈를 적어 두었다
    await pen(page, "b").click();
    await cell(page, "구민재", "R3").click();
    await expect(cell(page, "구민재", "R3")).toHaveAccessibleName("구민재 R3 b");
    await page.reload();
    await pen(page, "메모·자세히").click();
    await cell(page, "구민재", "R3").click();
    await expect(page.getByRole("dialog").getByLabel("메모")).toHaveValue("10분 지각");
    await page.keyboard.press("Escape");
    // 되돌려 둔다(뒤 테스트가 지각 4점을 본다)
    await pen(page, /^지각/).click();
    await cell(page, "구민재", "R3").click();
    await expect(cell(page, "구민재", "R3")).toHaveAccessibleName("구민재 R3 지각 4점");
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

test("PC: 칸을 먼저 누르지 않고 화살표로 시작해, 글쇠 하나로 적고 아래 칸으로 내려간다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "manager");
  await page.goto("/rounding");
  const cursor = page.locator('[data-day-grid] [data-cursor="true"]');
  // 처음 화살표는 오늘 돌 회차 맨 위 칸에 커서만 놓는다 — 아무것도 적지 않는다
  await page.keyboard.press("ArrowDown");
  await expect(cursor).toHaveCount(1);
  // R3 → R5 로 옮긴다
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const top = (await cursor.getAttribute("aria-label"))!.replace(/ R5 .*$/, "");
  await expect(cursor).toHaveAccessibleName(`${top} R5 빈 칸`);
  await expect(page.getByRole("button", { name: / R5 (a|b|부재)$/ })).toHaveCount(0);

  // B 는 그 칸을 b 로 적고 다음 줄로, 0 은 부재
  await page.keyboard.press("KeyB");
  await expect(cell(page, top, "R5")).toHaveAccessibleName(`${top} R5 b`);
  await page.keyboard.press("Digit0");
  await expect(page.getByRole("button", { name: /R5 부재$/ })).toHaveCount(1);
  // 잘못 적은 칸은 Delete
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Delete");
  await expect(page.getByRole("button", { name: /R5 부재$/ })).toHaveCount(0);

  // 펜 버튼 위에서 누른 Backspace·Enter 는 표가 가로채지 않는다
  await pen(page, "a").focus();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await expect(cell(page, top, "R5")).toHaveAccessibleName(`${top} R5 b`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("졸음 펜: 같은 날 앞 회차에 졸음이 있으면 연속 졸음으로 적는다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "manager");
  await page.goto("/rounding");
  await pen(page, /^졸음/).click();
  await cell(page, "나윤서", "R6").click();
  await expect(cell(page, "나윤서", "R6")).toHaveAccessibleName(/^나윤서 R6 (연속 )?졸음 \d점$/);
  await cell(page, "나윤서", "R7").click();
  await expect(cell(page, "나윤서", "R7")).toHaveAccessibleName("나윤서 R7 연속 졸음 6점");
  await expect(page.getByRole("status")).toContainText("앞 회차에 졸음이 있어");
});

test("앞으로의 날짜는 열어 볼 수만 있다", async ({ page }) => {
  await login(page, "assistant");
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await page.goto(`/rounding?date=${key}`);
  await expect(page.getByRole("toolbar", { name: "펜" })).toHaveCount(0);
  await expect(page.getByText("앞으로의 날짜라 적을 수 없습니다")).toBeVisible();
  await expect(page.getByRole("link", { name: "다음 날" })).toHaveCount(0);
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

test("멘토는 라운딩 표를 읽기만 하고, 칸을 누르면 메모를 본다", async ({ page }) => {
  await login(page, "mentor");
  await page.goto("/rounding");
  await expect(page.getByRole("heading", { name: "라운딩" })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "펜" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^\S+ R1 / })).toHaveCount(0);
  await expect(page.getByText("읽기 전용")).toBeVisible();
  // 시드: 사유(b) 칸에는 '학원 일정' 메모가 있다. 태블릿에는 마우스를 올려 보는 풍선말이 없으니 눌러서 본다
  await page.locator("td").filter({ hasText: /R[12] b · 메모: 학원 일정/ }).first().click();
  await expect(page.getByRole("status")).toContainText("학원 일정");
});
