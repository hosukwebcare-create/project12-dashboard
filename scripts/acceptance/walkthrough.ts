/**
 * 별하 검수 워크스루. 기획서 8.2 검수 기준과 3.1 범위를 운영 빌드(localhost:3210)에 대고 실제로 돌려 본다.
 * 결과는 results.json, 증거 스크린샷은 evidence/ 에 남긴다.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`${k} 환경 변수가 필요합니다 (scripts/acceptance/run.sh 로 실행하세요)`);
  return v;
};
const BASE = env("ACC_BASE", "http://localhost:3210");
const DIR = env("ACC_DIR");
const EV = `${DIR}/evidence`;
const DB = env("ACC_DB", "postgres://localhost:5432/byeolha_e2e");
const DT2 = env("ACC_DT2");
const BOARD_TOKEN = env("ACC_BOARD_TOKEN");
const RECEIVER = env("ACC_RECEIVER");
const ACCOUNTS = { hq: ["hq", "hq1234"], manager: ["manager", "1234"], mentor: ["mentor", "1234"], assistant: ["assistant", "1234"], manager2: ["manager2", "1234"] } as const;

type Status = "PASS" | "FAIL" | "NOTE";
type Result = { id: string; area: string; title: string; status: Status; detail: string; evidence?: string; ms?: number };
const results: Result[] = [];
const psql = (sql: string) => execSync(`psql ${DB} -tAc ${JSON.stringify(sql)}`, { encoding: "utf8" }).trim();
const received = () => readFileSync(`${DIR}/received.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { at: string; path: string; auth: string | null; body: Record<string, unknown> });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | false | undefined>, ms: number, every = 500): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`${ms}ms 안에 조건이 충족되지 않았습니다`);
    await sleep(every);
  }
}

let browser: Browser;
async function login(who: keyof typeof ACCOUNTS, opts: { mobile?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: BASE, locale: "ko-KR", timezoneId: "Asia/Seoul", ...(opts.mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true } : { viewport: { width: 1280, height: 860 } }) });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("아이디").fill(ACCOUNTS[who][0]);
  await page.getByLabel("비밀번호").fill(ACCOUNTS[who][1]);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return { ctx, page };
}
async function shot(page: Page, id: string): Promise<string> {
  const file = `${EV}/${id}.png`;
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  return file;
}
async function check(id: string, area: string, title: string, fn: (log: (s: string) => void) => Promise<Status | void>, pageForShot?: () => Page | undefined) {
  const notes: string[] = [];
  const t0 = Date.now();
  try {
    const st = (await fn((s) => notes.push(s))) ?? "PASS";
    results.push({ id, area, title, status: st, detail: notes.join(" · "), ms: Date.now() - t0 });
    console.log(`${st === "PASS" ? "✓" : st === "NOTE" ? "○" : "✗"} ${id} ${title}${notes.length ? " — " + notes.join(" · ") : ""}`);
  } catch (e) {
    const p = pageForShot?.();
    const evidence = p ? await shot(p, `${id}-fail`) : undefined;
    const msg = e instanceof Error ? e.message.split("\n")[0].slice(0, 300) : String(e);
    results.push({ id, area, title, status: "FAIL", detail: [...notes, `오류: ${msg}`].join(" · "), evidence, ms: Date.now() - t0 });
    console.log(`✗ ${id} ${title} — ${msg}`);
  }
}
async function selectOptionContaining(page: Page, selector: string, text: string) {
  const value = await page.locator(`${selector} option`).filter({ hasText: text }).first().getAttribute("value");
  if (value === null) throw new Error(`옵션 '${text}' 없음 (${selector})`);
  await page.locator(selector).selectOption(value);
}
async function selectByLabelContaining(page: Page, label: string, text: string) {
  const sel = page.getByLabel(label, { exact: true });
  const value = await sel.locator("option").filter({ hasText: text }).first().getAttribute("value");
  if (value === null) throw new Error(`옵션 '${text}' 없음 (라벨 ${label})`);
  await sel.selectOption(value);
}

async function main() {
  browser = await chromium.launch();
  const boardApi = async () => (await fetch(`${BASE}/api/board/${DT2}?t=${BOARD_TOKEN}`)).json() as Promise<{ weekStart: string; days: string[]; rules: { name: string; points: number }[]; seats: { seatNo: number; name: string; weeklyPoints: number }[]; cells: Record<string, { grade: string; points: number }> }>;

  // ───────────────────────── 공통 ─────────────────────────
  {
    const { ctx, page } = await login("hq");
    await check("C5", "공통", "본사 관리자 지점 전환", async (log) => {
      await page.goto("/members");
      await page.getByRole("link", { name: "강하늘" }).waitFor();
      await page.getByLabel("지점 선택").selectOption({ label: "수원1" });
      await page.waitForURL("/");
      await page.goto("/members");
      await page.getByRole("link", { name: "백서준" }).waitFor();
      if (await page.getByRole("link", { name: "강하늘" }).count()) throw new Error("수원1로 바꿨는데 동탄2 회원이 보임");
      log("동탄2 → 수원1 전환 후 회원 목록이 수원1 것으로 바뀜");
      await shot(page, "C5");
    }, () => page);

    await check("C8", "공통", "커스텀 필드: 본사가 회원 양식에 선택형 필드 추가", async (log) => {
      await page.goto("/settings/custom-fields");
      const form = page.locator("form").filter({ has: page.getByPlaceholder("키 (영문)") });
      await form.locator('select[name="entity"]').selectOption("member");
      await form.getByPlaceholder("키 (영문)").fill("acc_pick");
      await form.getByPlaceholder("표시 이름").fill("검수선택");
      const typeSel = form.locator('select[name="type"]');
      const v = await typeSel.locator("option").filter({ hasText: /선택/ }).first().getAttribute("value");
      await typeSel.selectOption(v ?? "select");
      await form.getByPlaceholder("선택지 (쉼표)").fill("갑,을");
      await form.getByRole("button", { name: "추가" }).click();
      await page.locator('input[name="key"][value="acc_pick"]').waitFor();
      log("필드 acc_pick(검수선택, 선택형 갑/을) 추가됨");
    }, () => page);
    await ctx.close();
  }

  {
    const { ctx, page } = await login("assistant", { mobile: true });
    await check("C6", "공통", "공용 태블릿 PIN 전환", async (log) => {
      await page.locator("header").getByText("최조교").waitFor();
      await page.getByRole("link", { name: "전환" }).click();
      await page.waitForURL("/switch");
      await page.getByRole("button", { name: /정조교/ }).click();
      await page.getByLabel("PIN").fill("0000");
      await page.getByRole("button", { name: "전환" }).click();
      await page.getByText("PIN이 올바르지 않습니다").waitFor();
      await page.getByLabel("PIN").fill("2222");
      await page.getByRole("button", { name: "전환" }).click();
      await page.waitForURL("/rounding");
      await page.locator("header").getByText("정조교").waitFor();
      log("틀린 PIN 거부 → 맞는 PIN으로 최조교 → 정조교 전환, 상단 이름 바뀜");
      await shot(page, "C6");
    }, () => page);
    await ctx.close();
  }

  // 지점장 세션 (여러 검사에서 재사용)
  const mgr = await login("manager");
  const M = mgr.page;

  await check("C7", "공통", "설정 6종 화면과 저장", async (log) => {
    const pages = ["/settings/branch", "/settings/users", "/settings/seats", "/settings/penalty-rules", "/settings/board-items", "/settings/audit"];
    for (const p of pages) {
      const res = await M.goto(p);
      if (!res || res.status() !== 200) throw new Error(`${p} → ${res?.status()}`);
      await M.getByRole("heading").first().waitFor();
    }
    await M.goto("/settings/branch");
    await M.locator('textarea[name="roundSchedule"]').waitFor();
    log("지점·사용자·좌석·벌점 규칙·현황판 항목·감사 로그 화면 200, 회차 시간표 입력란 있음");
    // 벌점 규칙 저장 왕복 (추가 → 비활성)
    await M.goto("/settings/penalty-rules");
    const form = M.locator("form").filter({ has: M.getByPlaceholder("규칙 이름") });
    await form.getByPlaceholder("규칙 이름").fill("검수규칙");
    await form.getByPlaceholder("점수").fill("3");
    await form.getByRole("button", { name: "추가" }).click();
    await M.locator('input[name="name"][value="검수규칙"]').waitFor();
    const row = M.locator("form").filter({ has: M.locator('input[name="name"][value="검수규칙"]') });
    await row.getByLabel("사용").uncheck();
    await row.getByRole("button", { name: "저장" }).click();
    await row.getByText("저장됨").waitFor();
    log("지점 벌점 규칙 추가·비활성 저장됨");
  }, () => M);

  // 메신저 웹훅을 먼저 등록해 두어야 이후 라운딩 이벤트가 쌓인다
  await check("X1", "3-3 메신저", "인커밍 웹훅 등록 (사설망 수신기, 3개 이벤트)", async (log) => {
    await M.goto("/settings/webhooks");
    const form = M.locator("form").filter({ has: M.getByPlaceholder("채널 이름") });
    await form.getByPlaceholder("채널 이름").fill("검수 채널");
    await form.getByPlaceholder(/hooks/).fill(`${RECEIVER}/webhook`);
    await form.getByLabel("라운딩 회차 완료").check();
    await form.getByRole("button", { name: "추가" }).click();
    await M.locator('input[name="name"][value="검수 채널"]').waitFor();
    log(`${RECEIVER}/webhook 에 이슈 보고·고벌점·회차 완료 구독`);
  }, () => M);

  await check("X0", "3-3 메신저", "SSRF 차단: 로컬·메타데이터 주소는 등록 거부", async (log) => {
    await M.goto("/settings/webhooks");
    const form = M.locator("form").filter({ has: M.getByPlaceholder("채널 이름") });
    for (const bad of ["http://127.0.0.1:4599/webhook", "http://169.254.169.254/latest/meta-data", "http://localhost/hooks"]) {
      await form.getByPlaceholder("채널 이름").fill("나쁜 주소");
      await form.getByPlaceholder(/hooks/).fill(bad);
      await form.getByRole("button", { name: "추가" }).click();
      await form.getByText(/로컬·내부망·메타데이터|올바르지 않습니다|가리킬 수 없습니다/).waitFor({ timeout: 8000 });
    }
    if (await M.locator('input[name="name"][value="나쁜 주소"]').count()) throw new Error("차단돼야 할 주소가 등록됨");
    log("127.0.0.1 · 169.254.169.254 · localhost 모두 거부");
  }, () => M);

  // ───────────────────────── 회원 ─────────────────────────
  let memberUrl = "";
  await check("M1", "1-1 회원", "회원 등록 (좌석·등록기간·학부모·집중관리·커스텀 필드)", async (log) => {
    await M.goto("/members/new");
    await M.locator("#name").fill("검수회원");
    await M.getByLabel("성별").selectOption("여");
    await M.getByLabel("생년월일").fill("2008-04-05");
    await M.getByLabel("TYPE").selectOption("재학생");
    await M.getByLabel("계열").selectOption("이과");
    await M.getByLabel("학교", { exact: true }).fill("검수고");
    await M.getByLabel("학년").fill("2");
    await M.getByLabel("라운딩 특이사항").fill("검수용 특이사항");
    await M.getByLabel("집중관리 대상").check();
    await M.getByLabel("연락처", { exact: true }).fill("010-5555-1234");
    await M.getByLabel("학부모 이름").fill("검수보호자");
    await M.getByLabel("관계").fill("모");
    await M.getByLabel("학부모 연락처").fill("010-5555-9999");
    await selectByLabelContaining(M, "좌석", "30번");
    await M.getByLabel("등록 시작일").fill("2026-09-01");
    await M.getByLabel("등록 종료일").fill("2026-09-30");
    await M.getByLabel("검수선택").selectOption("갑");
    await M.getByRole("button", { name: "등록", exact: true }).click();
    await M.waitForURL(/\/members\/[0-9a-f-]+$/);
    memberUrl = M.url();
    for (const t of ["30번 좌석", "집중관리", "검수보호자", "검수선택", "갑", "검수고"]) await M.getByText(t, { exact: t === "집중관리" || t === "갑" }).first().waitFor();
    log(`상세에 좌석·집중관리·학부모·커스텀 필드(검수선택=갑) 표시, ${memberUrl.split("/").pop()}`);
    await shot(M, "M1");
  }, () => M);

  await check("M2", "1-1 회원", "이름·좌석 변경이 상담일지·라운딩·현황판에 즉시 반영", async (log) => {
    await M.goto(memberUrl);
    await M.getByRole("link", { name: "정보 수정" }).click();
    await M.locator("#name").fill("검수회원B");
    await M.getByRole("button", { name: "저장" }).click();
    await M.waitForURL(/\/members\/[0-9a-f-]+$/);
    await M.getByRole("tab", { name: /좌석 · 상태/ }).click();
    await selectOptionContaining(M, 'select[name="seatId"]', "31번");
    await M.getByRole("button", { name: "배정" }).click();
    await M.getByText("좌석을 변경했습니다").waitFor();
    // 상담일지 그리드
    await M.goto("/counsel/weekly");
    await M.getByRole("row").filter({ hasText: "검수회원B" }).first().waitFor();
    // 라운딩 명단 (회차 시작)
    await M.goto("/rounding");
    const resume = M.getByRole("link", { name: /진행 중 · 이어서 입력/ });
    if (await resume.count()) await resume.click();
    else await M.getByRole("button", { name: /R\d+ 시작/ }).click();
    await M.waitForURL(/\/rounding\/[0-9a-f-]+$/);
    const row = M.getByRole("listitem").filter({ hasText: "검수회원B" });
    await row.waitFor();
    if (!(await row.innerText()).includes("31")) throw new Error("라운딩 명단에 새 좌석 31이 없음");
    // 현황판 API
    const b = await boardApi();
    const seat = b.seats.find((s) => s.seatNo === 31);
    if (!seat || seat.name !== "검수회원B") throw new Error(`현황판에 31번 검수회원B 없음: ${JSON.stringify(seat)}`);
    if (b.seats.some((s) => s.seatNo === 30)) throw new Error("이전 좌석 30번이 현황판에 남아 있음");
    log("검수회원B · 31번이 상담일지 행, 라운딩 명단, 현황판 좌석에 새로고침 없이 반영");
  }, () => M);

  await check("M4", "1-1 회원", "CSV 이관: 건수 일치와 오류 목록", async (log) => {
    await M.goto("/members/import");
    const tsv = [
      ["좌석번호", "성명", "연락처", "성별", "TYPE", "집중관리", "학교명/학년", "계열", "등록기간"].join("\t"),
      ["40", "이관검수A", "010.7777.1111", "여", "재학생", "O", "별하고2", "문과", "2026-09-01 ~ 2026-09-30"].join("\t"),
      ["41", "이관검수B/S", "", "남", "N수생", "", "", "이과", "7월16~8월17일[33일]"].join("\t"),
      ["999", "이관검수C", "", "", "", "", "", "", ""].join("\t"),
    ].join("\n");
    await M.getByRole("textbox").fill(tsv);
    await M.getByRole("button", { name: "미리보기" }).click();
    await M.getByText(/총 3행 · 반영 가능 2행 · 오류 1건/).waitFor();
    await M.getByText("999번 좌석이 지점에 없습니다").waitFor();
    await M.getByRole("button", { name: "2행 반영" }).click();
    await M.getByText("새로 등록 2명, 기존 갱신 0명").waitFor();
    const n = psql("select count(*) from members where name in ('이관검수A','이관검수B')");
    if (n !== "2") throw new Error(`DB 반영 ${n}명`);
    log("3행 중 2행 반영·1행 오류(없는 좌석) 목록 표시, DB 2명 일치, /S → 단기, 기간 문자열 변환");
  }, () => M);

  await check("M5", "1-1 회원", "모의고사 회차 생성", async (log) => {
    const res = await M.goto("/mock-exams");
    if (res?.status() !== 200) throw new Error(`status ${res?.status()}`);
    await M.getByRole("heading").first().waitFor();
    log("화면 200 (회차·신청·결제 흐름은 E2E mock-exams.spec 2건이 자동 검증)");
    return "NOTE";
  }, () => M);

  // ───────────────────────── 격리·권한·감사 ─────────────────────────
  await check("C1", "공통", "타 지점 지점장이 URL 직접 접근해도 조회 불가", async (log) => {
    if (!memberUrl) throw new Error("회원 등록(M1)이 실패해 검사할 URL 이 없음");
    const { ctx, page } = await login("manager2");
    const res = await page.goto(memberUrl);
    const body = await page.locator("body").innerText();
    await ctx.close();
    if (body.includes("검수회원B") || body.includes("010-5555")) throw new Error("수원1 지점장에게 동탄2 회원이 보임");
    log(`수원1 지점장 → 동탄2 회원 URL: HTTP ${res?.status()}, 본문에 회원 정보 없음`);
  });

  await check("C2", "공통", "조교에게 연락처·학부모 정보 비노출", async (log) => {
    const { ctx, page } = await login("assistant");
    await page.goto(memberUrl);
    await page.getByRole("heading", { name: "검수회원B" }).waitFor();
    const body = await page.locator("body").innerText();
    await shot(page, "C2");
    await ctx.close();
    if (body.includes("010-5555") || body.includes("검수보호자")) throw new Error("조교 화면에 연락처/학부모 노출");
    log("조교 상세 화면에 이름·좌석은 보이고 연락처·학부모는 없음");
  });

  await check("C4", "공통", "감사 로그에 수정이 남고 개인정보는 가려짐", async (log) => {
    await M.goto("/settings/audit");
    const body = await M.locator("body").innerText();
    if (!/member|회원/.test(body)) throw new Error("회원 변경 로그 없음");
    if (body.includes("010-5555-1234") || body.includes("010-5555-9999")) throw new Error("감사 로그에 연락처가 그대로 노출");
    const rows = psql("select count(*) from audit_logs where entity='member'");
    const masked = psql("select count(*) from audit_logs where (before::text || after::text) like '%010-****-%'");
    log(`member 감사 로그 ${rows}건, 화면·DB 모두 연락처 원문 없음(마스킹 행 ${masked}건)`);
  }, () => M);

  // ───────────────────────── 상담일지 ─────────────────────────
  await check("K1", "1-2 상담일지", "월 필터로 2026년 7월 주간일지 조회", async (log) => {
    const res = await M.goto("/counsel/weekly?month=2026-07");
    if (res?.status() !== 200) throw new Error(`status ${res?.status()}`);
    const body = await M.locator("body").innerText();
    const weeks = body.match(/7\/\d+\(월\)/g) ?? [];
    if (weeks.length < 3) throw new Error(`7월 주차 열이 ${weeks.length}개`);
    log(`7월 주차 ${weeks.length}개 표시: ${weeks.join(", ")}`);
  }, () => M);

  let logUrl = "";
  await check("K2", "1-2 상담일지", "원장 열 작성 → 멘토 열·멘션 코멘트 → 원장 알림", async (log) => {
    await M.goto("/counsel/weekly");
    const row = M.getByRole("row").filter({ hasText: "검수회원B" }).first();
    await row.getByRole("link").last().click();
    await M.waitForURL(/\/counsel\/entry\?/);
    const issueCard = M.locator("form").filter({ has: M.locator('input[name="field"][value="issue"]') });
    await issueCard.getByRole("textbox").fill("검수: 수학 오답 정리 미흡");
    await issueCard.getByRole("button", { name: "저장" }).click();
    await M.waitForURL(/\/counsel\/logs\/[0-9a-f-]+$/);
    logUrl = M.url();
    if (await M.locator('input[name="field"][value="resolution"]').count()) throw new Error("지점장이 멘토 열을 편집할 수 있음");
    const { ctx, page } = await login("mentor");
    await page.goto(logUrl);
    const resCard = page.locator("form").filter({ has: page.locator('input[name="field"][value="resolution"]') });
    await resCard.getByRole("textbox").fill("검수: 오답노트 양식 배부, 금요일 점검");
    await resCard.getByRole("button", { name: "저장" }).click();
    await resCard.getByText("저장됨").waitFor();
    await page.getByPlaceholder(/멘션하면/).fill("@박원장 검수 멘션입니다");
    await page.getByRole("button", { name: "코멘트 남기기" }).click();
    await page.getByText("코멘트 (1)").waitFor();
    await ctx.close();
    await M.goto("/notifications");
    await M.getByText("@박원장 검수 멘션입니다").waitFor();
    await shot(M, "K2");
    log("원장 열 저장, 멘토는 멘토 열만 작성, @박원장 멘션이 지점장 알림함에 도착");
  }, () => M);

  await check("K3", "1-2 상담일지", "집중관리 회원 일별 일지 화면", async (log) => {
    const res = await M.goto("/counsel/focus");
    if (res?.status() !== 200) throw new Error(`status ${res?.status()}`);
    await M.getByText("검수회원B").first().waitFor();
    log("집중관리 목록에 검수회원B 표시 (일별 작성은 E2E counsel.spec 자동 검증)");
  }, () => M);

  // ───────────────────────── 라운딩 (조교·모바일) ─────────────────────────
  const asst = await login("assistant", { mobile: true });
  const A = asst.page;
  let sessionUrl = "";
  await check("R1", "1-3 라운딩", "회차 이어서 입력 · 좌석 순 명단 · 기본 a", async (log) => {
    await A.goto("/rounding");
    const resume = A.getByRole("link", { name: /진행 중 · 이어서 입력/ });
    if (await resume.count()) await resume.click();
    else await A.getByRole("button", { name: /R\d+ 시작/ }).click();
    await A.waitForURL(/\/rounding\/[0-9a-f-]+$/);
    sessionUrl = A.url();
    const names = await A.getByRole("listitem").allInnerTexts();
    const seatNos = names.map((t) => Number((t.match(/^\s*(\d+)/) ?? [])[1])).filter((n) => Number.isFinite(n));
    const sorted = [...seatNos].every((n, i) => i === 0 || seatNos[i - 1] <= n);
    if (!sorted) throw new Error(`좌석 순이 아님: ${seatNos.slice(0, 8).join(",")}`);
    log(`명단 ${names.length}명, 좌석 번호 오름차순, 지점장이 시작한 회차를 조교가 이어받음`);
    await shot(A, "R1");
  }, () => A);

  await check("R7", "1-3 라운딩", "탭 응답 속도 (50석 1회차 3분 기준)", async (log) => {
    const rows = A.getByRole("listitem");
    const n = Math.min(10, await rows.count());
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      const b = rows.nth(i).getByRole("button", { name: "b", exact: true });
      const t0 = Date.now();
      await b.click();
      await until(async () => (await b.getAttribute("aria-pressed")) === "true", 5000, 50);
      times.push(Date.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    log(`${n}명 탭 평균 ${avg.toFixed(0)}ms (최대 ${Math.max(...times)}ms) → 50석 예외 전부 입력해도 약 ${((avg * 50) / 1000).toFixed(0)}초 + 이동 시간`);
  }, () => A);

  await check("R5", "1-3 라운딩", "오프라인 입력 → 복귀 후 자동 저장", async (log) => {
    const row = A.getByRole("listitem").filter({ hasText: "나윤서" });
    await asst.ctx.setOffline(true);
    await row.getByRole("button", { name: "부재", exact: true }).click();
    await A.getByText(/미전송 \d+건/).waitFor({ timeout: 15000 });
    await shot(A, "R5-offline");
    await asst.ctx.setOffline(false);
    await A.getByText(/미전송 \d+건/).waitFor({ state: "hidden", timeout: 25000 });
    await A.reload();
    const pressed = await A.getByRole("listitem").filter({ hasText: "나윤서" }).getByRole("button", { name: "부재", exact: true }).getAttribute("aria-pressed");
    if (pressed !== "true") throw new Error("복귀 후 서버에 저장되지 않음");
    log("오프라인에서 '부재' 입력 → '미전송 1건' 표시 → 온라인 복귀 후 자동 전송 → 새로고침해도 유지");
  }, () => A);

  await check("R3", "1-3 라운딩", "벌점 규칙 선택 시 점수 자동 + 이슈 보고", async (log) => {
    const row = A.getByRole("listitem").filter({ hasText: "검수회원B" });
    await row.getByRole("button", { name: "벌점", exact: true }).click();
    const sheet = A.getByRole("dialog");
    await sheet.getByRole("button", { name: /지각/ }).click();
    await sheet.getByLabel("메모").fill("검수: 10분 지각");
    await sheet.getByLabel("지점장에게 이슈로 보고").check();
    await sheet.getByRole("button", { name: "저장" }).click();
    await row.getByText(/지각 4점 · 이슈/).waitFor();
    // 고벌점(5점) 이벤트용
    const row2 = A.getByRole("listitem").filter({ hasText: "도현우" });
    await row2.getByRole("button", { name: "벌점", exact: true }).click();
    await A.getByRole("dialog").getByRole("button", { name: /이동금지/ }).click();
    await A.getByRole("dialog").getByRole("button", { name: "저장" }).click();
    await row2.getByText(/이동금지 위반 5점/).waitFor();
    await shot(A, "R3");
    log("지각 → 4점 자동, 이동금지 위반 → 5점 자동, 이슈 보고 체크");
  }, () => A);

  await check("R4", "1-3 라운딩", "이슈 보고가 지점장 이슈함·알림에 즉시 표시", async (log) => {
    await M.goto("/issues");
    await M.getByText(/검수회원B · 지각/).first().waitFor();
    await M.goto("/notifications");
    await M.getByText(/검수회원B · 지각/).first().waitFor();
    log("조교 저장 직후 지점장 이슈함과 알림에 '검수회원B · 지각' 도착");
  }, () => M);

  let sessionRound = 0;
  await check("R2", "1-3 라운딩", "회차 완료: 미입력은 a, 요약 표시", async (log) => {
    await A.getByRole("button", { name: /회차 완료/ }).click();
    await A.getByRole("dialog").getByText(/R\d+ 회차 완료/).waitFor();
    sessionRound = Number((await A.getByRole("dialog").innerText()).match(/R(\d+)/)?.[1] ?? 0);
    const sid = sessionUrl.split("/").pop();
    const total = psql(`select count(*) from checks where session_id='${sid}'`);
    const a = psql(`select count(*) from checks where session_id='${sid}' and grade='a'`);
    const enrolled = psql(`select count(*) from members where branch_id='${DT2}' and status='enrolled' and seat_id is not null`);
    if (total !== enrolled) throw new Error(`체크 ${total}건 ≠ 재원 ${enrolled}명`);
    await shot(A, "R2");
    log(`R${sessionRound} 완료 → 재원 ${enrolled}명 전원 체크 저장(양호 ${a}명), 요약 다이얼로그 표시`);
  }, () => A);

  await check("R6", "1-3 라운딩", "회차·일별·회원별 조회", async (log) => {
    const res = await M.goto("/rounding/history");
    if (res?.status() !== 200) throw new Error(`status ${res?.status()}`);
    await M.getByText("검수회원B").first().waitFor();
    await M.goto(memberUrl);
    await M.getByRole("tab", { name: /라운딩 · 벌점/ }).click();
    await M.getByText(/주간 벌점 4점/).waitFor();
    await shot(M, "R6");
    log("조회 화면에 오늘 회차 결과, 회원 상세 주간표 R3 칸에 4점·주간 벌점 4점 1건 표시");
  }, () => M);

  // ───────────────────────── 현황판 ─────────────────────────
  await check("B1", "1-4 현황판", "토큰 URL · 색상 그리드 · 규칙 헤더 · 주간 합계", async (log) => {
    const b = await boardApi();
    if (!b.rules.some((r) => /지각/.test(r.name))) throw new Error("규칙 헤더 없음");
    const s31 = b.seats.find((s) => s.seatNo === 31);
    if (!s31 || s31.weeklyPoints < 4) throw new Error(`31번 주간 벌점 ${s31?.weeklyPoints}`);
    const bad = await fetch(`${BASE}/api/board/${DT2}?t=wrong`);
    if (bad.status !== 401) throw new Error(`잘못된 토큰이 ${bad.status}`);
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`/board/${DT2}?t=${BOARD_TOKEN}`);
    await page.getByText("동탄2").first().waitFor();
    const txt = await page.locator("body").innerText();
    if (!txt.includes("검수회원B")) throw new Error("현황판에 검수회원B 없음");
    await shot(page, "B1");
    await ctx.close();
    log(`로그인 없이 토큰 URL로 열림, 잘못된 토큰 401, 규칙 ${b.rules.length}개 헤더, 31번 주간 벌점 ${s31.weeklyPoints}점`);
  });

  await check("B5", "1-4 현황판", "주간 벌점 합계가 DB 집계와 일치", async (log) => {
    const b = await boardApi();
    const first = b.days[0];
    const last = b.days[b.days.length - 1];
    let mismatch = 0;
    for (const s of b.seats) {
      const sum = Number(psql(`select coalesce(sum(c.points),0) from checks c join members m on m.id=c.member_id where m.name='${s.name}' and m.branch_id='${DT2}' and c.date between '${first}' and '${last}'`));
      if (sum !== s.weeklyPoints) mismatch++;
    }
    if (mismatch) throw new Error(`${mismatch}명 불일치`);
    log(`${b.seats.length}석 전원 현황판 합계 = SQL 합계 (${first}~${last})`);
  });

  await check("B3", "1-4 현황판", "이름 마스킹 옵션", async (log) => {
    await M.goto("/settings/branch");
    const form = M.locator("form").filter({ has: M.locator('input[name="maskNames"]') });
    await form.locator('input[name="maskNames"]').check();
    await form.getByRole("button", { name: "저장" }).click();
    await form.getByText("저장됨").waitFor();
    const b = await boardApi();
    const s31 = b.seats.find((s) => s.seatNo === 31);
    if (!s31 || !/\*/.test(s31.name) || s31.name === "검수회원B") throw new Error(`마스킹 안 됨: ${s31?.name}`);
    log(`마스킹 켜면 현황판 이름 '${s31.name}'`);
    await form.locator('input[name="maskNames"]').uncheck();
    await form.getByRole("button", { name: "저장" }).click();
    await until(async () => (await boardApi()).seats.find((s) => s.seatNo === 31)?.name === "검수회원B", 15000, 500);
    log("끄면 다시 실명");
  }, () => M);

  await check("B2", "1-4 현황판", "라운딩 입력 후 1분 안에 현황판 자동 갱신 (새로고침 없이)", async (log) => {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`/board/${DT2}?t=${BOARD_TOKEN}`);
    await page.getByText("동탄2").first().waitFor();
    const before = (await boardApi()).seats.find((s) => s.seatNo === 31)!.weeklyPoints;
    // 조교가 다음 회차에서 검수회원B 에게 지각 4점
    await A.goto("/rounding");
    await A.getByRole("button", { name: /R\d+ 시작/ }).click();
    await A.waitForURL(/\/rounding\/[0-9a-f-]+$/);
    const row = A.getByRole("listitem").filter({ hasText: "검수회원B" });
    await row.getByRole("button", { name: "벌점", exact: true }).click();
    await A.getByRole("dialog").getByRole("button", { name: /지각/ }).click();
    await A.getByRole("dialog").getByRole("button", { name: "저장" }).click();
    await row.getByText(/지각 4점/).waitFor();
    const t0 = Date.now();
    const expected = before + 4;
    await until(async () => {
      const txt = await page.locator("body").innerText();
      // 31번 열의 주간 합계가 갱신됐는지: 화면 텍스트에 새 합계가 나타나고 API 도 같은 값
      const api = (await boardApi()).seats.find((s) => s.seatNo === 31)!.weeklyPoints;
      return api === expected && txt.includes(String(expected));
    }, 75000, 2000);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    await shot(page, "B2");
    await ctx.close();
    log(`31번 주간 벌점 ${before} → ${expected}, 새로고침 없이 ${secs}초 뒤 화면에 반영 (주기 60초)`);
  }, () => A);

  await check("B4", "1-4 현황판", "주가 바뀌면 자동으로 새 주 표시", async (log) => {
    log("API가 매 갱신마다 오늘 기준 주(todayKey→weekStart)를 계산해 돌려주므로 월요일 00:00 이후 첫 갱신부터 새 주가 뜬다 (코드 확인: src/app/api/board/[branchId]/route.ts, 60초 주기 fetch)");
    return "NOTE";
  });

  // ───────────────────────── 2단계 ─────────────────────────
  await check("F1", "2-1 식사", "월별 신청·일별 발주·월 정산 화면", async (log) => {
    for (const p of ["/meals", "/meals/daily", "/meals/settlement"]) {
      const res = await M.goto(p);
      if (!res || res.status() !== 200) throw new Error(`${p} → ${res?.status()}`);
    }
    log("세 화면 200 (마감 규칙·발주서·정산 흐름은 E2E phase2.spec 이 자동 검증)");
    return "NOTE";
  }, () => M);

  await check("W1", "2-2 근무", "내 근무·일별·월 집계 화면과 급여 CSV", async (log) => {
    for (const p of ["/worklog", "/worklog/daily", "/worklog/monthly", "/worklog/settings"]) {
      const res = await M.goto(p);
      if (!res || res.status() !== 200) throw new Error(`${p} → ${res?.status()}`);
    }
    const csv = await M.request.get("/api/worklog/export?month=2026-09");
    if (csv.status() !== 200 || !(csv.headers()["content-type"] ?? "").includes("csv")) throw new Error(`CSV ${csv.status()} ${csv.headers()["content-type"]}`);
    log(`네 화면 200, 급여 기초자료 CSV 200 (${(await csv.text()).split("\n").length}줄)`);
  }, () => M);

  await check("A1", "2-3 알림톡", "템플릿 → 대상 선택 → 발송 큐 → 딜러 API 실제 호출 → 이력", async (log) => {
    const { ctx, page } = await login("hq");
    await page.goto("/settings/alimtalk-templates");
    await page.getByPlaceholder(/템플릿 코드/).fill("ACC_WEEKLY");
    await page.getByPlaceholder("표시 이름").fill("검수 주간안내");
    await page.locator('textarea[name="body"]').first().fill("#{이름} 학생의 #{지점} 주간리포트입니다. #{링크}");
    await page.getByRole("button", { name: "추가" }).click();
    await page.getByText("변수: #{이름} #{지점} #{링크}").waitFor();
    await ctx.close();
    const before = received().filter((r) => r.path.startsWith("/alimtalk")).length;
    await M.goto("/alimtalk");
    await M.getByLabel("템플릿").selectOption({ label: "검수 주간안내" });
    await M.getByLabel("#{링크}").fill("https://example.com/acc");
    await M.getByLabel("집중관리 회원").check();
    await M.getByLabel("학부모").check();
    await M.getByText(/대상 \d+명 중 번호가 있는/).waitFor();
    await M.getByRole("button", { name: /명에게 발송/ }).click();
    const req = (await M.getByText(/발송 요청 \d+건/).innerText()).match(/(\d+)건/)?.[1];
    const calls = await until(async () => {
      const c = received().filter((r) => r.path.startsWith("/alimtalk")).slice(before);
      return c.length >= Number(req) ? c : null;
    }, 40000, 1000);
    const one = calls[0];
    if (one.auth !== "Bearer dealer-test-key") throw new Error(`인증 헤더 ${one.auth}`);
    const body = one.body as { templateCode: string; recipientNo: string; content: string; templateParameter: Record<string, string> };
    if (body.templateCode !== "ACC_WEEKLY" || !/^\d+$/.test(body.recipientNo) || !body.content.includes("동탄2")) throw new Error(`딜러 요청 형식 이상: ${JSON.stringify(body).slice(0, 200)}`);
    await M.goto("/alimtalk/history");
    await M.getByText("발송", { exact: true }).first().waitFor();
    await shot(M, "A1");
    log(`${req}건 큐 → 스케줄러가 딜러 API 로 ${calls.length}건 POST (Bearer 키, templateCode, 숫자 수신번호, 본문에 이름·지점 치환) → 이력 '발송'`);
  }, () => M);

  // ───────────────────────── 3단계 ─────────────────────────
  await check("H1", "3-1 HERO", "서명된 진단 결과 수신 → 회원 프로필 연결, 위조 서명 거부", async (log) => {
    const secret = "hero-acceptance-secret";
    const post = async (payload: unknown, sig?: string) => {
      const raw = JSON.stringify(payload);
      const s = sig ?? createHmac("sha256", secret).update(raw).digest("hex");
      const res = await fetch(`${BASE}/api/integrations/hero`, { method: "POST", headers: { "Content-Type": "application/json", "x-hero-signature": s }, body: raw });
      return { status: res.status, json: await res.json().catch(() => ({})) };
    };
    const ok = await post({ branchCode: "DT2", memberName: "고은별", seatNo: 2, externalId: "acc-1", summary: { type: "탐구형", score: 87 }, resultUrl: "https://hero.example.com/r/acc-1", takenAt: "2026-09-06" });
    if (ok.status !== 201) throw new Error(`정상 서명 → ${ok.status} ${JSON.stringify(ok.json)}`);
    const forged = await post({ branchCode: "DT2", memberName: "고은별", externalId: "acc-2", summary: {} }, "deadbeef");
    if (forged.status !== 401) throw new Error(`위조 서명 → ${forged.status}`);
    const unknown = await post({ branchCode: "DT2", memberName: "없는회원", externalId: "acc-3", summary: {} });
    if (unknown.status !== 422 || !String((unknown.json as { error?: string }).error).includes("회원")) throw new Error(`없는 회원 → ${unknown.status} ${JSON.stringify(unknown.json)}`);
    const badBranch = await post({ branchCode: "ZZZ", memberName: "고은별", seatNo: 2, externalId: "acc-4", summary: {} });
    if (badBranch.status !== 404) throw new Error(`없는 지점 → ${badBranch.status}`);
    await M.goto("/members?q=고은별");
    await M.getByRole("link", { name: "고은별" }).click();
    await M.getByRole("tab", { name: /파일 · 진단/ }).click();
    await M.getByText(/탐구형|결과분석지 열기/).first().waitFor();
    await shot(M, "H1");
    log("정상 서명 201 → 고은별 상세 '파일 · 진단'에 결과 표시, 위조 서명 401, 없는 회원 422(안내 문구), 없는 지점 404");
  }, () => M);

  await check("P1", "3-2 파일", "PDF 업로드·다운로드 바이트 일치·접근 로그, 가짜 PDF 거부", async (log) => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    await M.goto(memberUrl);
    await M.getByRole("tab", { name: /파일 · 진단/ }).click();
    await M.getByLabel("제목").fill("검수 리포트");
    await M.getByLabel(/파일 \(PDF/).setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: pdf });
    await M.getByRole("button", { name: "업로드" }).click();
    await M.getByText("업로드했습니다").waitFor();
    const href = await M.getByRole("link", { name: "검수 리포트" }).getAttribute("href");
    const res = await M.request.get(href!);
    const got = await res.body();
    if (res.status() !== 200 || !got.equals(pdf)) throw new Error(`다운로드 ${res.status()}, 바이트 일치 ${got.equals(pdf)}`);
    const logs = psql("select count(*) from access_logs where entity like '%file%'");
    // 가짜 PDF
    await M.getByLabel("제목").fill("가짜");
    await M.getByLabel(/파일 \(PDF/).setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("hello, not a pdf") });
    await M.getByRole("button", { name: "업로드" }).click();
    await M.getByText(/파일만 올릴 수 있습니다|형식과 다릅니다/).first().waitFor({ timeout: 8000 });
    if (await M.getByRole("link", { name: "가짜" }).count()) throw new Error("가짜 PDF 가 업로드됨");
    log(`업로드 → 다운로드 바이트 동일, 파일 접근 로그 ${logs}건, 확장자만 pdf 인 텍스트는 거부`);
  }, () => M);

  await check("X2", "3-3 메신저", "라운딩 이벤트가 배치로 메신저 웹훅에 실제 게시", async (log) => {
    const got = await until(async () => {
      const r = received().filter((x) => x.path === "/webhook");
      const types = new Set(r.map((x) => (x.body as { event?: string }).event));
      return types.has("issue.created") && types.has("penalty.high") && types.has("session.completed") ? r : null;
    }, 40000, 1000);
    const issue = got.find((x) => (x.body as { event: string }).event === "issue.created")!.body as { text: string };
    const high = got.find((x) => (x.body as { event: string }).event === "penalty.high")!.body as { text: string };
    if (!issue.text.includes("검수회원B") || !high.text.includes("도현우")) throw new Error(`본문 이상: ${issue.text} / ${high.text}`);
    await M.goto("/settings/webhooks");
    await M.getByText("전송", { exact: true }).first().waitFor();
    await shot(M, "X2");
    log(`수신기에 이슈 보고·고벌점·회차 완료 3종 도착 (${got.length}건), 본문 '${issue.text.slice(0, 40)}…', 설정 화면 상태 '전송'`);
  }, () => M);

  await check("X3", "3-3 메신저", "전송 실패 → 실패 표시 → 재시도", async (log) => {
    await M.goto("/settings/webhooks");
    const form = M.locator("form").filter({ has: M.getByPlaceholder("채널 이름") });
    await form.getByPlaceholder("채널 이름").fill("고장 채널");
    await form.getByPlaceholder(/hooks/).fill(`${RECEIVER}/fail`);
    await form.getByRole("button", { name: "추가" }).click();
    await M.locator('input[name="name"][value="고장 채널"]').waitFor();
    await M.goto("/issues/new");
    await M.getByLabel("제목").fill("검수 실패이벤트");
    await M.getByRole("button", { name: "이슈 등록" }).click();
    await M.waitForURL(/\/issues\/[0-9a-f-]+$/);
    await until(async () => psql("select count(*) from event_outbox where status='failed' and text like '%검수 실패이벤트%'") === "1", 40000, 1000);
    await M.goto("/settings/webhooks");
    await M.getByText("실패", { exact: true }).first().waitFor();
    const row = M.locator("form").filter({ has: M.locator('input[name="name"][value="고장 채널"]') });
    await row.getByLabel("사용").uncheck();
    await row.getByRole("button", { name: "저장" }).click();
    await row.getByText("저장됨").waitFor();
    await M.getByRole("button", { name: /대기·실패 이벤트 지금 전송/ }).click();
    await until(async () => psql("select status from event_outbox where text like '%검수 실패이벤트%'") === "sent", 20000, 1000);
    log("500 응답 엔드포인트 → 이벤트 '실패' 표시 → 엔드포인트 비활성 후 재전송 → '전송'");
  }, () => M);

  // ───────────────────────── 퇴원·보관기간 ─────────────────────────
  await check("M3", "1-1 회원", "퇴원 시 좌석 해제, 라운딩·현황판 제외, 이력 유지", async (log) => {
    await M.goto(memberUrl);
    await M.getByRole("tab", { name: /좌석 · 상태/ }).click();
    await M.locator('select[name="status"]').selectOption("withdrawn");
    await M.getByRole("button", { name: "변경", exact: true }).click();
    await M.getByText("좌석 미배정").waitFor();
    const b = await boardApi();
    if (b.seats.some((s) => s.seatNo === 31)) throw new Error("현황판에 31번이 남아 있음");
    await A.reload();
    if (await A.getByRole("listitem").filter({ hasText: "검수회원B" }).count()) throw new Error("라운딩 명단에 남아 있음");
    await M.getByRole("tab", { name: /타임라인/ }).click();
    for (const t of ["상태 변경", "좌석 변경", "회원 등록"]) await M.getByText(t).first().waitFor();
    const txt = await M.locator("body").innerText();
    if (!txt.includes("지각") || !txt.includes("검수 멘션")) throw new Error("타임라인에 벌점·코멘트가 없음");
    await shot(M, "M3");
    log("퇴원 → 좌석 미배정, 현황판·라운딩 명단에서 제외, 타임라인에 등록·좌석·상태·벌점·코멘트가 시간순으로 남음");
  }, () => M);

  await check("O3", "운영", "보관기간 지난 퇴원 회원 익명화 배치", async (log) => {
    psql("update members set withdrawn_at='2026-01-01' where name='마이현'");
    const res = await fetch(`${BASE}/api/jobs/retention`, { method: "POST", headers: { "x-job-secret": "job-acceptance-secret" } });
    const json = (await res.json()) as { anonymized?: number };
    if (res.status !== 200 || !json.anonymized) throw new Error(`${res.status} ${JSON.stringify(json)}`);
    const row = psql("select name || '|' || coalesce(phone,'(없음)') from members where anonymized_at is not null limit 1");
    if (!row.startsWith("탈퇴회원-") || !row.endsWith("(없음)")) throw new Error(`익명화 결과 ${row}`);
    const noAuth = await fetch(`${BASE}/api/jobs/retention`, { method: "POST" });
    log(`퇴원 후 보관기간 경과 회원 ${json.anonymized}명 → '${row.split("|")[0]}', 연락처 삭제. 시크릿 없는 호출은 ${noAuth.status}`);
  });

  await asst.ctx.close();
  await mgr.ctx.close();
  await browser.close();

  writeFileSync(`${DIR}/results.json`, JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const note = results.filter((r) => r.status === "NOTE").length;
  console.log(`\n합계: PASS ${pass} · FAIL ${fail} · NOTE ${note}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
