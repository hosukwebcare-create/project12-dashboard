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
    await form.getByPlaceholder("분 (15)").fill("30");
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
    // 오늘이 일요일이면 일요일 타임만 보이므로, 보이는 첫 타임을 체크하고 라벨에서 분을 읽는다
    const firstSlot = p2.getByRole("checkbox", { name: /타임/ }).first();
    const slotLabel = (await firstSlot.locator("xpath=..").textContent()) ?? "";
    const slotMinutes = Number(slotLabel.match(/(\d+)분/)?.[1] ?? "0");
    const slotName = slotLabel.match(/^(\S+타임)/)?.[1] ?? "";
    await firstSlot.check();
    await p2.getByLabel("초과근무 (시간)").fill("0.5");
    await p2.getByLabel("초과근무 사유").fill("마감 정리");
    await p2.getByRole("button", { name: "저장" }).click();
    await expect(p2.getByText("저장됨")).toBeVisible();
    // 시트처럼 분을 먼저 시간으로 바꾼 뒤 초과근무를 더한다
    const total = (Math.round((slotMinutes / 60) * 100) + 50) / 100;
    await expect(p2.getByText(new RegExp(`= ${total}h`))).toBeVisible();
    await ctx2.close();

    await page.goto("/worklog/daily");
    await expect(page.getByRole("checkbox", { name: `최조교 ${slotName}` }).first()).toBeChecked();
    await expect(page.getByLabel("최조교 초과근무 시간")).toHaveValue("0.5");
    await expect(page.getByLabel("최조교 초과근무 사유")).toHaveValue("마감 정리");

    const ctx3 = await browser.newContext();
    const p3 = await ctx3.newPage();
    await login(p3, "hq");
    await p3.goto("/worklog/daily");
    await p3.getByRole("row").filter({ hasText: "최조교" }).getByRole("button", { name: "확인" }).click();
    await expect(p3.getByRole("row").filter({ hasText: "최조교" })).toContainText("본사운영");
    await ctx3.close();

    await page.goto("/worklog/monthly");
    // 월 집계 줄(시급 칸이 있는 줄). 아래 날짜별 표에도 같은 이름 줄이 있다
    const mrow = page.getByRole("row").filter({ has: page.getByLabel("최조교 시급") });
    await expect(page.getByLabel("최조교 시급")).toHaveValue("10500");
    await expect(mrow).toContainText(/\d+(\.\d+)?h/);
    const csv = await page.request.get(`/api/worklog/export?month=${todayKey().slice(0, 7)}`);
    expect(csv.status(), await csv.text()).toBe(200);
    expect(await csv.text()).toContain("최조교");

    // 날짜별 근무시간(시트의 근무통계): 근무자 × 날짜, 오늘 칸은 근무시간 + 초과, 누르면 그날 일별 현황
    const today = todayKey();
    const day = Number(today.slice(8));
    const cellLink = page.getByRole("link", { name: new RegExp(`^최조교 ${Number(today.slice(5, 7))}월 ${day}일 [\\d.]+시간 본사 확인$`) });
    await expect(cellLink).toBeVisible();
    await cellLink.click();
    await expect(page).toHaveURL(new RegExp(`/worklog/daily\\?date=${today}`));
    const dailyCsv = await page.request.get(`/api/worklog/export?month=${today.slice(0, 7)}&layout=daily`);
    expect(dailyCsv.status()).toBe(200);
    const head = (await dailyCsv.text()).split("\r\n")[0];
    expect(head).toContain(`${Number(today.slice(5, 7))}.${day}`);
    expect(head.endsWith("합계")).toBe(true);
  });

  test("시트 타임표는 근무 형태별로 나뉘고, 조교가 평일을 다 채우면 시트와 같은 2.5시간이 된다", async ({ page, browser }) => {
    await login(page, "manager");
    await page.goto("/worklog/settings");
    for (const label of ["주간조교 (조교)", "원장", "컨설팅 (학습멘토)"]) {
      await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    }
    // 야간조교는 없어졌다
    await expect(page.getByRole("heading", { name: /야간조교/ })).toHaveCount(0);
    // 시트 수식 그대로: 주간조교 1타임 60분, 원장 1타임 360분(16:00~23:00)
    const slotForm = (key: string) => page.locator("form").filter({ has: page.locator(`input[name="key"][value="${key}"]`) });
    await expect(slotForm("d1").getByLabel("인정 시간(분)")).toHaveValue("60");
    await expect(slotForm("d1").getByLabel("근무 형태")).toHaveValue("주간조교");
    await expect(slotForm("m1").getByLabel("인정 시간(분)")).toHaveValue("360");
    await expect(slotForm("m1").getByLabel("시작")).toHaveValue("16:00");

    const ctx2 = await browser.newContext({ timezoneId: "Asia/Seoul" });
    const p2 = await ctx2.newPage();
    await login(p2, "assistant");
    // 오늘은 앞 테스트에서 본사 확인이 끝나 잠겨 있다. 일요일이 아닌 지난 평일을 골라 연다
    const day = new Date();
    day.setDate(day.getDate() - 14);
    while (day.getDay() === 0) day.setDate(day.getDate() - 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    await p2.goto(`/worklog?date=${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`);
    // 주간조교에게는 자기 타임만 보인다. 컨설팅·원장 타임은 같은 '1타임'이라도 보이지 않는다
    await expect(p2.getByText("주간조교 타임")).toBeVisible();
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await p2.getByRole("checkbox", { name: new RegExp(`^${n}타임`) }).check();
    await p2.getByRole("button", { name: "저장" }).click();
    await expect(p2.getByText("저장됨")).toBeVisible();
    // 60 + 15×6 = 150분 → 시트와 같은 2.5시간
    await expect(p2.getByText(/= 2\.5h/)).toBeVisible();
    await ctx2.close();

    // 일별 현황은 현장에서 부르는 대로 청소조교 · 조교 · 원장 · 학습멘토로 묶인다 (평일 타임이 보이도록 일요일은 피한다)
    const wd = new Date();
    while (wd.getDay() === 0) wd.setDate(wd.getDate() - 1);
    const p2d = (n: number) => String(n).padStart(2, "0");
    await page.goto(`/worklog/daily?date=${wd.getFullYear()}-${p2d(wd.getMonth() + 1)}-${p2d(wd.getDate())}`);
    for (const g of ["청소조교", "조교", "원장", "학습멘토"]) await expect(page.locator("caption").filter({ hasText: new RegExp(`^${g}\\d`) })).toBeVisible();
    // 청소조교 줄에는 주간조교 타임(2~7타임)이 나오지 않는다 — 지점이 청소조교 타임을 따로 만든다
    await expect(page.getByLabel("한청소 근무 형태")).toHaveValue("청소조교");
    await expect(page.getByRole("checkbox", { name: "한청소 2타임" })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "정조교 2타임" })).toHaveCount(1);
  });

  test("일별 현황 표에서 설정 화면에 가지 않고 바로 체크하고 근무 형태·요일을 고친다", async ({ page, browser }) => {
    await login(page, "manager");
    const day = new Date();
    day.setDate(day.getDate() - 7);
    while (day.getDay() === 0) day.setDate(day.getDate() - 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    await page.goto(`/worklog/daily?date=${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`);

    // 정조교(주간조교) 줄에서 1~7타임을 바로 체크 → 2.5시간
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      await page.getByRole("checkbox", { name: `정조교 ${n}타임` }).check();
      await expect(page.getByText(/정조교 타임 저장됨/)).toBeVisible();
    }
    const row = page.locator("tbody tr").filter({ has: page.getByRole("checkbox", { name: "정조교 1타임" }) });
    await expect(row).toContainText("2.5");

    // 초과근무는 사유와 함께
    await page.getByLabel("정조교 초과근무 시간").fill("0.5");
    await page.getByLabel("정조교 초과근무 사유").fill("커피머신 청소");
    await page.getByLabel("정조교 초과근무 사유").press("Enter");
    await expect(page.getByText(/정조교 초과근무 저장됨/)).toBeVisible();
    await expect(row.locator("td").last()).toHaveText("3");

    // 근무 요일·근무 형태도 이 줄에서
    await page.getByLabel("정조교 근무 요일").fill("월화수일");
    await page.getByLabel("정조교 근무 요일").press("Enter");
    await expect(page.getByText(/정조교 근무 요일 저장됨/)).toBeVisible();
    // 한청소(청소조교)를 주간조교로 바꾸면 조교 묶음으로 옮겨 간다
    await page.getByLabel("한청소 근무 형태").selectOption("주간조교");
    await expect(page.getByText(/한청소 근무 형태 저장됨/)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("정조교 근무 요일")).toHaveValue("월화수일");
    await expect(page.getByRole("checkbox", { name: "정조교 7타임" })).toBeChecked();
    await expect(page.getByLabel("정조교 초과근무 사유")).toHaveValue("커피머신 청소");
    await expect(page.getByLabel("한청소 근무 형태")).toHaveValue("주간조교");
    await expect(page.getByRole("checkbox", { name: "한청소 2타임" })).toHaveCount(1);
    // 되돌려 둔다
    await page.getByLabel("한청소 근무 형태").selectOption("청소조교");
    await expect(page.getByText(/한청소 근무 형태 저장됨/)).toBeVisible();

    // 본사 확인을 눌러도 다른 줄에 적고 있던 초과근무는 그대로다
    const hqCtx = await browser.newContext();
    const hq = await hqCtx.newPage();
    await login(hq, "hq");
    await hq.goto(page.url());
    // 사유만 적고 시간은 아직 안 적은 채(저장되지 않고 칸에 남는다) 다른 줄의 확인을 누른다
    await hq.getByLabel("최조교 초과근무 사유").fill("적는 중");
    await hq.locator("tbody tr").filter({ has: hq.getByRole("checkbox", { name: "정조교 1타임" }) }).getByRole("button", { name: "확인" }).click();
    await expect(hq.getByText(/정조교 본사 확인/)).toBeVisible();
    await expect(hq.getByLabel("최조교 초과근무 사유")).toHaveValue("적는 중");
    await expect(hq.getByRole("checkbox", { name: "정조교 1타임" })).toBeDisabled();
    // 확인을 취소해 둔다
    await hq.locator("tbody tr").filter({ has: hq.getByRole("checkbox", { name: "정조교 1타임" }) }).getByRole("button", { name: "취소" }).click();
    await expect(hq.getByRole("checkbox", { name: "정조교 1타임" })).toBeEnabled();
    await hqCtx.close();
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

// 앞 테스트가 최조교의 오늘 기록을 본사 확인으로 잠그므로(그게 정상 동작이다) 다른 계정을 쓴다
test("출퇴근 시계: 출근하면 타이머가 흐르고 퇴근하면 시간이 기록된다", async ({ page, browser }) => {
  await login(page, "mentor");
  await page.goto("/worklog");

  const card = page.locator('[data-slot="work-clock"]');
  const clockIn = card.getByRole("button", { name: "출근", exact: true });
  const clockOut = card.getByRole("button", { name: "퇴근", exact: true });

  await expect(card.getByText("출근 전입니다.")).toBeVisible();
  await expect(card.getByText("출근 : --:--:--")).toBeVisible();
  // 출근 전에는 퇴근을 누를 수 없다
  await expect(clockOut).toBeDisabled();
  await clockIn.click();

  await expect(card.getByText("근무 중입니다.")).toBeVisible();
  await expect(card.getByText(/^출근 : \d\d:\d\d:\d\d$/)).toBeVisible();
  await expect(clockIn).toBeDisabled();
  await expect(clockOut).toBeEnabled();

  // 링 안의 시간이 1초마다 다시 그려진다
  const timer = card.getByText(/^\d\dh \d\dm \d\ds$/);
  const first = await timer.innerText();
  await page.waitForTimeout(2200);
  expect(await timer.innerText()).not.toBe(first);

  await clockOut.click();
  await expect(card.getByText("오늘 퇴근했습니다.")).toBeVisible();
  await expect(card.getByText(/^퇴근 : \d\d:\d\d:\d\d$/)).toBeVisible();
  await expect(card.getByRole("button", { name: "다시 출근" })).toBeEnabled();

  // 이번 주 요약이 함께 보인다
  await expect(card.getByText("주 소정근로시간")).toBeVisible();
  await expect(card.getByRole("progressbar", { name: "이번 주 누적 근로시간" })).toBeVisible();

  // 지점장 일별 현황에 출퇴근 시각이 남는다
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await login(p2, "manager");
  await p2.goto("/worklog/daily");
  await expect(p2.locator("tbody tr").filter({ hasText: "이멘토" }).first()).toContainText(/\d\d:\d\d ~ \d\d:\d\d/);
  await ctx2.close();
});
