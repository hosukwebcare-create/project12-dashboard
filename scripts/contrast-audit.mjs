/**
 * 모든 화면의 글자 대비를 실제로 재서 WCAG AA 미만을 찾아낸다.
 *
 *   PORT=3210 pnpm dev            # 먼저 개발 서버를 띄운다 (시드 데이터 필요)
 *   node scripts/contrast-audit.mjs [--base http://localhost:3210]
 *
 * 눈으로 보는 대신 계산한다. 흰 배경에 흰 글씨 같은 사고는 스크린샷을 아무리
 * 들여다봐도 "빈 곳"으로 보이기 때문에 놓친다.
 *
 * 기준: 본문 4.5:1, 큰 글씨(18.66px 이상 굵게 / 24px 이상) 3:1.
 * 실명이 찍히지 않도록 글자는 앞 24자까지만 남긴다.
 */
import { chromium } from "@playwright/test";

const base = (() => {
  const i = process.argv.indexOf("--base");
  return i >= 0 ? process.argv[i + 1] : "http://localhost:3210";
})();

const ROUTES = [
  ["/login", null],
  ["/", "manager"],
  ["/members", "manager"],
  ["/counsel/weekly", "manager"],
  ["/counsel/schedule", "manager"],
  ["/mock-exams", "manager"],
  ["/rounding", "assistant"],
  ["/daily-checks", "assistant"],
  ["/meals", "manager"],
  ["/meals/settlement", "manager"],
  ["/worklog", "manager"],
  ["/worklog/daily", "manager"],
  ["/worklog/settings", "manager"],
  ["/payments", "manager"],
  ["/handover", "manager"],
  ["/issues", "manager"],
  ["/alimtalk", "manager"],
  ["/notifications", "manager"],
  ["/settings/branch", "manager"],
  ["/settings/seats", "manager"],
  ["/settings/fees", "manager"],
  ["/settings/penalty-rules", "manager"],
  ["/settings/users", "manager"],
  ["/settings/board-items", "manager"],
  ["/settings/custom-fields", "manager"],
  ["/settings/alimtalk-templates", "manager"],
  ["/settings/webhooks", "manager"],
  ["/settings/audit", "manager"],
  ["/settings/branches", "manager"],
  ["/members/new", "manager"],
  ["/meals/daily", "manager"],
  ["/meals/settings", "manager"],
  ["/worklog/monthly", "manager"],
  ["/counsel/focus", "manager"],
  ["/counsel/entry", "manager"],
  ["/rounding/history", "assistant"],
  ["/issues?status=all", "manager"],
];

/** 페이지 안에서 도는 검사기. 브라우저 컨텍스트로 넘어가므로 바깥 변수를 쓰지 않는다. */
function collect() {
  // 색은 문자열로 파싱하지 않는다. 이 프로젝트의 토큰은 oklch 라서 rgb() 정규식으로는
  // 대부분이 null 이 되고, 그러면 "검사 못 한 것"이 "통과"로 둔갑한다.
  // 1x1 캔버스에 실제로 칠해 픽셀을 읽으면 어떤 표기든 같은 값이 된다.
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  const parse = (c) => {
    if (!c) return null;
    if (cache.has(c)) return cache.get(c);
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = c;
    // 브라우저가 못 읽는 값이면 fillStyle 이 그대로 #000 으로 남는다. 그 경우만 걸러낸다.
    if (cx.fillStyle === "#000000" && !/^(#000000|#000|black|rgba?\(0,\s*0,\s*0)/.test(c.trim())) {
      cache.set(c, null);
      return null;
    }
    cx.clearRect(0, 0, 1, 1);
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    const v = { r, g, b, a: a / 255 };
    cache.set(c, v);
    return v;
  };
  const unparsed = new Set();
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  /** 투명 배경은 위로 올라가며 실제로 칠해진 색을 찾는다 */
  const bgOf = (el) => {
    let acc = null;
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (!c || c.a === 0) continue;
      acc = acc ? over(acc, c) : c;
      if (acc.a >= 0.999) return acc;
    }
    return acc ?? { r: 255, g: 255, b: 255, a: 1 };
  };

  const out = [];
  const seen = new Set();
  // 검사한 개수를 함께 돌려준다. 0건 통과가 "문제 없음"인지 "아무것도 안 봤음"인지
  // 구분하지 못하면 이 검사는 쓸모가 없다 (실제로 색 파싱이 조용히 실패해 그런 적이 있다).
  let checked = 0;
  const push = (el, st, text, fgRaw, kind) => {
    const fg = parse(fgRaw);
    if (!fg) { unparsed.add(fgRaw); return; }
    const bg = bgOf(el);
    if (fg.a === 0 && (el.getAttribute("aria-label") || el.getAttribute("title"))) return;
    const eff = fg.a < 1 ? over(fg, bg) : fg;
    const size = parseFloat(st.fontSize);
    const weight = +st.fontWeight || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(eff, bg);
    checked++;
    if (r >= need) return;
    const key = `${kind}|${el.tagName}|${fgRaw}|${st.fontSize}|${text.slice(0, 24)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      tag: el.tagName.toLowerCase() + (kind === "placeholder" ? " (자리표시)" : ""),
      cls: (typeof el.className === "string" ? el.className : "").slice(0, 70),
      text: text.slice(0, 24), color: fgRaw,
      bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
      size: `${size}px/${weight}`, ratio: Math.round(r * 100) / 100, need,
    });
  };
  // 입력칸 자리표시 글자
  for (const el of document.querySelectorAll("input[placeholder], textarea[placeholder]")) {
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || el.disabled) continue;
    if (el.getBoundingClientRect().width < 1) continue;
    const ph = getComputedStyle(el, "::placeholder").color;
    if (ph) push(el, st, el.getAttribute("placeholder") ?? "", ph, "placeholder");
  }
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("svg")) continue;
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    if (!text) continue;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || +st.opacity === 0) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    push(el, st, text, st.color, "text");
  }
  return { bad: out, unparsed: [...unparsed], checked };
}

async function login(page, who) {
  await page.goto(`${base}/login`);
  await page.getByLabel("아이디").fill(who);
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ko-KR" });
  const page = await ctx.newPage();
  let current = null;
  let total = 0;
  let totalChecked = 0;

  for (const [route, who] of ROUTES) {
    if (who !== current) {
      if (who) await login(page, who);
      current = who;
    }
    try {
      await page.goto(base + route, { waitUntil: "networkidle", timeout: 20000 });
    } catch {
      console.log(`\n### ${route}  — 열지 못함`);
      continue;
    }
    const { bad, unparsed, checked } = await page.evaluate(collect);
    total += bad.length;
    totalChecked += checked;
    if (unparsed.length) console.log(`\n### ${route}  — 읽지 못한 색 ${unparsed.length}종: ${unparsed.slice(0, 3).join(", ")}`);
    if (checked < 5) console.log(`\n### ${route}  — 검사한 글자가 ${checked}개뿐입니다. 화면이 비었거나 검사기가 막힌 것입니다.`);
    else if (!bad.length) {
      console.log(`### ${route}  ✓  (${checked}개 확인)`);
      continue;
    }
    if (bad.length) console.log(`\n### ${route}  — ${bad.length}건 / ${checked}개 중`);
    for (const b of bad.sort((a, c) => a.ratio - c.ratio)) {
      console.log(`  ${String(b.ratio).padStart(5)} : ${b.need}  ${b.tag}  "${b.text}"`);
      console.log(`         색 ${b.color} / 배경 ${b.bg} / ${b.size}`);
      if (b.cls) console.log(`         class ${b.cls}`);
    }
  }
  // 회원 상세·수정은 주소에 id 가 들어가서 목록에서 따라 들어간다
  const auditOne = async (label) => {
    const { bad, unparsed, checked } = await page.evaluate(collect);
    total += bad.length;
    totalChecked += checked;
    if (unparsed.length) console.log(`\n### ${label}  — 읽지 못한 색 ${unparsed.length}종`);
    if (checked < 5) console.log(`\n### ${label}  — 검사한 글자가 ${checked}개뿐입니다.`);
    else if (!bad.length) console.log(`### ${label}  ✓  (${checked}개 확인)`);
    else {
      console.log(`\n### ${label}  — ${bad.length}건 / ${checked}개 중`);
      for (const b of bad.sort((a, c) => a.ratio - c.ratio)) {
        console.log(`  ${String(b.ratio).padStart(5)} : ${b.need}  ${b.tag}  "${b.text}"`);
        console.log(`         색 ${b.color} / 배경 ${b.bg} / ${b.size}`);
        if (b.cls) console.log(`         class ${b.cls}`);
      }
    }
  };
  try {
    await login(page, "manager");
    await page.goto(base + "/members", { waitUntil: "networkidle" });
    const href = await page.locator('tbody a[href^="/members/"]').first().getAttribute("href");
    if (href) {
      await page.goto(base + href, { waitUntil: "networkidle" });
      await auditOne("/members/[id] (회원 상세)");
      for (const tab of ["타임라인", "라운딩 · 벌점", "파일 · 진단", "좌석 · 상태"]) {
        const t = page.getByRole("link", { name: new RegExp(tab.split(" ")[0]) }).first();
        if (await t.count()) {
          await t.click();
          await page.waitForLoadState("networkidle");
          await auditOne(`/members/[id] · ${tab}`);
        }
      }
      await page.goto(base + href + "/edit", { waitUntil: "networkidle" });
      await auditOne("/members/[id]/edit (회원 수정)");
    }
  } catch (e) {
    console.log(`\n### 회원 상세  — 검사하지 못했습니다: ${e.message.split("\n")[0]}`);
  }

  // 현황판(매장 모니터)은 로그인 없이 열리는 화면이고 멀리서 읽어야 해서 대비가 더 중요하다.
  // 링크는 한 번만 표시되므로 설정 화면에서 새로 발급받아 검사한다.
  try {
    await login(page, "manager");
    await page.goto(base + "/settings/branch", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /링크 (재)?발급/ }).click();
    const link = await page.locator('a[href*="/board/"]').first().getAttribute("href", { timeout: 10000 });
    if (link) {
      await page.goto(link.startsWith("http") ? link : base + link, { waitUntil: "networkidle" });
      const { bad, checked } = await page.evaluate(collect);
      total += bad.length;
      totalChecked += checked;
      if (!bad.length) console.log(`### /board (현황판)  ✓  (${checked}개 확인)`);
      else {
        console.log(`\n### /board (현황판)  — ${bad.length}건 / ${checked}개 중`);
        for (const b of bad.sort((a, c) => a.ratio - c.ratio)) {
          console.log(`  ${String(b.ratio).padStart(5)} : ${b.need}  ${b.tag}  "${b.text}"`);
          console.log(`         색 ${b.color} / 배경 ${b.bg} / ${b.size}`);
          if (b.cls) console.log(`         class ${b.cls}`);
        }
      }
    }
  } catch (e) {
    console.log(`\n### /board (현황판)  — 검사하지 못했습니다: ${e.message.split("\n")[0]}`);
  }

  console.log(`\n== 글자 ${totalChecked}개 확인 · 기준 미달 ${total}건`);
  await browser.close();
  process.exit(total ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
