/**
 * 모든 화면을 역할별로 열어 보고 서버 오류·콘솔 오류·깨진 링크를 찾는다.
 *
 *   PORT=3210 pnpm dev && node scripts/smoke-sweep.mjs
 *
 * 대비 검사(contrast-audit)가 "읽히는가"를 본다면 이건 "열리는가"를 본다.
 * 화면을 하나씩 눌러 보는 것으로는 역할 4개 × 화면 40개를 못 돈다.
 */
import { chromium } from "@playwright/test";

const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3210";

const ROUTES = [
  "/", "/members", "/members/new", "/members/import",
  "/counsel/weekly", "/counsel/schedule", "/counsel/focus", "/counsel/entry",
  "/mock-exams", "/rounding",
  "/meals", "/meals/daily", "/meals/settlement", "/meals/settings",
  "/worklog", "/worklog/daily", "/worklog/monthly", "/worklog/settings",
  "/payments", "/handover", "/issues", "/alimtalk", "/notifications",
  "/settings/branch", "/settings/branches", "/settings/users", "/settings/seats",
  "/settings/fees", "/settings/penalty-rules", "/settings/board-items",
  "/settings/custom-fields", "/settings/alimtalk-templates", "/settings/webhooks", "/settings/audit", "/settings/security",
  "/account",
];
const USERS = [
  ["hq", "hq1234", "본사 관리자"],
  ["manager", "1234", "지점장"],
  ["mentor", "1234", "멘토"],
  ["assistant", "1234", "조교"],
];

async function main() {
  const browser = await chromium.launch();
  let problems = 0;
  for (const [id, pw, label] of USERS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ko-KR" });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
    page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message.slice(0, 160)));

    await page.goto(`${base}/login`);
    await page.getByLabel("아이디").fill(id);
    await page.getByLabel("비밀번호").fill(pw);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });

    console.log(`\n===== ${label} (${id}) =====`);
    for (const route of ROUTES) {
      consoleErrors.length = 0;
      let status = 0;
      const res = await page.goto(base + route, { waitUntil: "networkidle", timeout: 20000 }).catch(() => null);
      status = res?.status() ?? 0;
      // 좁은 화면에서 페이지 자체가 가로로 넘치는지 (표는 카드 안에서만 넘쳐야 한다)
      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.setViewportSize({ width: 1440, height: 1000 });
      const body = await page.evaluate(() => ({
        text: (document.querySelector("main") ?? document.body).innerText.slice(0, 200),
        // 링크가 가리키는 곳이 이 앱 안인지, href 가 빠지지 않았는지
        deadLinks: [...document.querySelectorAll("a")].filter((a) => { const h = a.getAttribute("href"); return !h || h === "#" || h === "undefined" || h.includes("undefined") || h.includes("null"); }).map((a) => a.textContent.trim().slice(0, 20)),
        emptyButtons: [...document.querySelectorAll("button")].filter((b) => !b.textContent.trim() && !b.getAttribute("aria-label") && !b.querySelector("svg")).length,
      }));
      const denied = /권한이 없습니다|접근할 수 없습니다/.test(body.text);
      const crashed = status >= 500 || /Application error|Internal Server Error|Unhandled/.test(body.text);
      const notFound = status === 404 || /This page could not be found/.test(body.text);
      const flags = [];
      if (crashed) flags.push(`서버오류 ${status}`);
      if (notFound) flags.push("404");
      if (consoleErrors.length) flags.push(`콘솔오류 ${consoleErrors.length}: ${consoleErrors[0]}`);
      if (body.deadLinks.length) flags.push(`빈 링크 ${body.deadLinks.length}: ${body.deadLinks.slice(0, 3).join("/")}`);
      if (body.emptyButtons) flags.push(`이름 없는 버튼 ${body.emptyButtons}`);
      if (overflow > 1) flags.push(`390px에서 가로 넘침 ${overflow}px`);
      if (flags.length) { problems += flags.length; console.log(`  ✗ ${route}  ${flags.join(" · ")}`); }
      else console.log(`  ${denied ? "·" : "✓"} ${route}${denied ? "  (권한 없음 안내)" : ""}`);
    }
    await ctx.close();
  }
  console.log(`\n== 문제 ${problems}건`);
  await browser.close();
  process.exit(problems ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
