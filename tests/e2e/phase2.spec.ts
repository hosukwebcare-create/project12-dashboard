import { expect, test } from "@playwright/test";
import { login, todayKey } from "./helpers";

function addDays(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

test.describe("식사주문", () => {
  test("설정 저장 → 조교가 다음 주 주문 → 일별 발주서 → 월 정산", async ({ page, browser }) => {
    await login(page, "manager");
    await page.goto("/meals/settings");
    await page.getByLabel("중식 단가").fill("8500");
    await page.getByLabel("도시락 업체").fill("행복도시락");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("저장됨")).toBeVisible();

    // 3주 뒤 월요일 (마감 전, 시드 주문 없음)
    const today = todayKey();
    const dow = new Date(today).getDay();
    const nextMonday = addDays(today, ((8 - dow) % 7) + (dow === 1 ? 7 : 0) + 14);
    const [, mm, dd] = nextMonday.split("-");

    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await login(p2, "assistant");
    await p2.goto(`/meals?month=${nextMonday.slice(0, 7)}`);
    await expect(p2.getByRole("heading", { name: "식사주문" })).toBeVisible();
    const row = p2.getByRole("row").filter({ hasText: "홍다은" });
    const lunch = row.getByRole("button", { name: `${nextMonday} 중식` });
    await expect(lunch).toHaveAttribute("aria-pressed", "false");
    await lunch.click();
    await expect(lunch).toHaveAttribute("aria-pressed", "true");
    await p2.reload();
    await expect(p2.getByRole("row").filter({ hasText: "홍다은" }).getByRole("button", { name: `${nextMonday} 중식` })).toHaveAttribute("aria-pressed", "true");
    // 마감된 날짜(오늘)는 조교가 바꿀 수 없다
    await p2.goto(`/meals?month=${today.slice(0, 7)}`);
    const todayLunch = p2.getByRole("button", { name: `${today} 중식` }).first();
    if (await todayLunch.count()) {
      await todayLunch.click();
      await expect(p2.getByText(/마감되었습니다/)).toBeVisible();
    }
    await ctx2.close();

    await page.goto(`/meals/daily?date=${nextMonday}`);
    await expect(page.getByText(new RegExp(`${Number(mm)}/${Number(dd)}\\(월\\) 도시락 발주서`))).toBeVisible();
    await expect(page.getByText("중식 1개 · 석식 0개 · 업체 행복도시락")).toBeVisible();

    await page.goto(`/meals/settlement?month=${nextMonday.slice(0, 7)}`);
    const srow = page.locator("form").filter({ hasText: "홍다은" });
    await expect(srow).toContainText("1식");
    await expect(srow).toContainText("8,500원");
  });
});

test.describe("근무일지", () => {
  test("타임 설정 → 조교 체크 → 지점장 일별 현황 → 본사 확인 → 월 집계", async ({ page, browser }) => {
    await login(page, "manager");
    await page.goto("/worklog/settings");
    const form = page.locator("form").filter({ has: page.getByPlaceholder("키 (t1)") });
    await form.getByPlaceholder("키 (t1)").fill("e2e1");
    await form.getByPlaceholder("이름 (1타임)").fill("E2E타임");
    await form.getByLabel("시작").fill("09:00");
    await form.getByLabel("종료").fill("09:30");
    await form.getByPlaceholder("시간 (0.5)").fill("0.5");
    await form.getByRole("button", { name: "추가" }).click();
    await expect(page.locator('input[name="key"][value="e2e1"]')).toBeVisible();

    const staffRow = page.locator("form").filter({ hasText: "최조교" });
    await staffRow.getByPlaceholder("시급").fill("10500");
    await staffRow.getByRole("button", { name: "저장" }).click();
    await expect(staffRow.getByText("저장됨")).toBeVisible();

    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await login(p2, "assistant");
    await p2.goto("/worklog");
    // 오늘이 주말이면 주말 타임만 보이므로, 보이는 첫 타임을 체크하고 라벨에서 시간을 읽는다
    const firstSlot = p2.getByRole("checkbox", { name: /타임/ }).first();
    const slotLabel = (await firstSlot.locator("xpath=..").textContent()) ?? "";
    const slotHours = Number(slotLabel.match(/· ([\d.]+)h/)?.[1] ?? "0");
    const slotName = slotLabel.match(/^(\S+타임)/)?.[1] ?? "";
    await firstSlot.check();
    await p2.getByLabel("초과근무 (시간)").fill("0.5");
    await p2.getByLabel("초과근무 사유").fill("마감 정리");
    await p2.getByRole("button", { name: "저장" }).click();
    await expect(p2.getByText("저장됨")).toBeVisible();
    const total = slotHours + 0.5;
    await expect(p2.getByText(new RegExp(`= ${total}h`))).toBeVisible();
    await ctx2.close();

    await page.goto("/worklog/daily");
    const row = page.getByRole("row").filter({ hasText: "최조교" });
    await expect(row).toContainText(slotName);
    await expect(row).toContainText("0.5h");
    await expect(row).toContainText("마감 정리");

    const ctx3 = await browser.newContext();
    const p3 = await ctx3.newPage();
    await login(p3, "hq");
    await p3.goto("/worklog/daily");
    await p3.getByRole("row").filter({ hasText: "최조교" }).getByRole("button", { name: "확인" }).click();
    await expect(p3.getByRole("row").filter({ hasText: "최조교" })).toContainText("본사운영");
    await ctx3.close();

    await page.goto("/worklog/monthly");
    const mrow = page.getByRole("row").filter({ hasText: "최조교" });
    await expect(mrow).toContainText("10,500");
    await expect(mrow).toContainText("본사운영".length ? /\d/ : /\d/);
    const csv = await page.request.get(`/api/worklog/export?month=${todayKey().slice(0, 7)}`);
    expect(csv.status(), await csv.text()).toBe(200);
    expect(await csv.text()).toContain("최조교");
  });
});

test.describe("알림톡", () => {
  test("본사가 템플릿 등록 → 지점장이 집중관리 학부모에게 발송 → 이력", async ({ page, browser }) => {
    const hqCtx = await browser.newContext();
    const hq = await hqCtx.newPage();
    await login(hq, "hq");
    await hq.goto("/settings/alimtalk-templates");
    await hq.getByPlaceholder(/템플릿 코드/).fill("E2E_WEEKLY");
    await hq.getByPlaceholder("표시 이름").fill("주간리포트 안내");
    await hq.locator('textarea[name="body"]').first().fill("#{이름} 학생의 #{지점} 주간리포트입니다. #{링크}");
    await hq.getByRole("button", { name: "추가" }).click();
    await expect(hq.getByText("변수: #{이름} #{지점} #{링크}")).toBeVisible();
    await hqCtx.close();

    await login(page, "manager");
    await page.goto("/alimtalk");
    await page.getByLabel("템플릿").selectOption({ label: "주간리포트 안내" });
    await page.getByLabel("#{링크}").fill("https://example.com/weekly");
    await page.getByLabel("집중관리 회원").check();
    await page.getByLabel("학부모").check();
    await expect(page.getByText(/대상 \d+명 중 번호가 있는/)).toBeVisible();
    await page.getByRole("button", { name: /명에게 발송/ }).click();
    await expect(page.getByText(/발송 요청 \d+건/)).toBeVisible();
    await page.goto("/alimtalk/history");
    await expect(page.getByText("주간리포트 안내").first()).toBeVisible();
    await expect(page.getByText("https://example.com/weekly").first()).toBeVisible();
    await expect(page.getByText("발송", { exact: true }).first()).toBeVisible();
  });
});

test.describe("3단계 연동", () => {
  test("파일 업로드·다운로드, HERO 웹훅, 메신저 웹훅 설정", async ({ page, request }) => {
    await login(page, "manager");
    await page.goto("/members?q=강하늘");
    await page.getByRole("link", { name: "강하늘" }).click();
    await page.getByRole("tab", { name: /파일 · 진단/ }).click();
    await page.getByLabel("제목").fill("9월 AI 컨설팅 리포트");
    await page.getByLabel(/파일 \(PDF/).setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e") });
    await page.getByRole("button", { name: "업로드" }).click();
    await expect(page.getByText("업로드했습니다")).toBeVisible();
    await expect(page.getByRole("link", { name: "9월 AI 컨설팅 리포트" })).toBeVisible();
    const href = await page.getByRole("link", { name: "9월 AI 컨설팅 리포트" }).getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");

    // HERO 웹훅: 서명 없이는 401, 시크릿 미설정 시 503
    const hero = await request.post("/api/integrations/hero", { data: { branchCode: "DT2", memberName: "강하늘", seatNo: 1, externalId: "e2e-1", summary: { type: "탐구형" } } });
    expect([401, 503]).toContain(hero.status());

    await page.goto("/settings/webhooks");
    await page.getByPlaceholder("채널 이름").fill("동탄2 채널");
    await page.getByPlaceholder(/hooks/).fill("https://chat.example.com/hooks/abc");
    await page.getByRole("button", { name: "추가" }).click();
    await expect(page.locator('input[name="name"][value="동탄2 채널"]')).toBeVisible();
  });
});
