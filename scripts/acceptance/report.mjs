/**
 * 검수 워크스루 결과(results.json)와 수신기 기록으로 검수 결과서 HTML 을 만든다.
 *   node scripts/acceptance/report.mjs <run 디렉터리> [출력 html]
 * 결과 표는 results.json 을 그대로 옮기고, 앞뒤의 설명과 운영 점검 결과는 아래 상수에 둔다.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const [runDir, outPath = "docs/09_검수_결과서.html"] = process.argv.slice(2);
if (!runDir) throw new Error("run 디렉터리를 주세요");
const results = JSON.parse(readFileSync(`${runDir}/results.json`, "utf8"));
const received = existsSync(`${runDir}/received.jsonl`) ? readFileSync(`${runDir}/received.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const batch = existsSync(`${runDir}/batch.log`) ? readFileSync(`${runDir}/batch.log`, "utf8").trim().split("\n").filter(Boolean) : [];
const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
const ran = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const note = results.filter((r) => r.status === "NOTE").length;

// 기획서 3.1·8.2 의 모듈 순서
const AREAS = ["공통", "1-1 회원", "1-2 상담일지", "1-3 라운딩", "1-4 현황판", "2-1 식사", "2-2 근무", "2-3 알림톡", "3-1 HERO", "3-2 파일", "3-3 메신저", "운영"];
const byArea = AREAS.map((a) => ({ area: a, rows: results.filter((r) => r.area === a) })).filter((g) => g.rows.length);

const webhookCounts = received.filter((r) => r.path === "/webhook").reduce((m, r) => ((m[r.body.event] = (m[r.body.event] ?? 0) + 1), m), {});
const alimtalkCalls = received.filter((r) => r.path.startsWith("/alimtalk"));
const webhookSample = received.find((r) => r.path === "/webhook" && r.body.event === "session.completed") ?? received.find((r) => r.path === "/webhook");
const alimtalkSample = alimtalkCalls[0];

const statusLabel = { PASS: "통과", FAIL: "실패", NOTE: "참고" };

const rows = byArea
  .map(
    (g) => `
      <tr class="area"><th colspan="4">${esc(g.area)}</th></tr>
      ${g.rows
        .map(
          (r) => `
      <tr>
        <td class="id">${esc(r.id)}</td>
        <td>${esc(r.title)}</td>
        <td class="st ${r.status.toLowerCase()}">${statusLabel[r.status]}</td>
        <td class="detail">${esc(r.detail)}</td>
      </tr>`,
        )
        .join("")}`,
  )
  .join("");

const html = `<title>별하 검수 결과서</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hahmlet:wght@400;600;700&family=IBM+Plex+Sans+KR:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" />
<style>
  :root {
    --paper: oklch(0.975 0.005 85); --paper-2: oklch(1 0 0);
    --ink: oklch(0.22 0.02 262); --ink-2: oklch(0.47 0.02 262); --ink-3: oklch(0.6 0.015 262);
    --rule: oklch(0.885 0.008 85); --navy: oklch(0.32 0.07 262); --brass: oklch(0.62 0.11 75);
    --good: oklch(0.55 0.13 155); --good-bg: oklch(0.94 0.05 155);
    --bad: oklch(0.53 0.19 25); --bad-bg: oklch(0.94 0.05 25);
    --note-bg: oklch(0.95 0.03 85); --none-bg: oklch(0.93 0.004 85);
    --measure: 44rem;
    --font-display: "Hahmlet", "Apple SD Gothic Neo", serif;
    --font-body: "IBM Plex Sans KR", -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
    --font-mono: "IBM Plex Mono", ui-monospace, monospace;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --paper: oklch(0.19 0.015 262); --paper-2: oklch(0.23 0.016 262);
    --ink: oklch(0.94 0.006 85); --ink-2: oklch(0.74 0.012 262); --ink-3: oklch(0.62 0.014 262);
    --rule: oklch(0.31 0.016 262); --navy: oklch(0.82 0.05 262); --brass: oklch(0.79 0.11 75);
    --good: oklch(0.75 0.13 155); --good-bg: oklch(0.3 0.05 155);
    --bad: oklch(0.72 0.15 25); --bad-bg: oklch(0.31 0.06 25);
    --note-bg: oklch(0.3 0.03 85); --none-bg: oklch(0.26 0.008 262);
  } }
  :root[data-theme="dark"] {
    --paper: oklch(0.19 0.015 262); --paper-2: oklch(0.23 0.016 262);
    --ink: oklch(0.94 0.006 85); --ink-2: oklch(0.74 0.012 262); --ink-3: oklch(0.62 0.014 262);
    --rule: oklch(0.31 0.016 262); --navy: oklch(0.82 0.05 262); --brass: oklch(0.79 0.11 75);
    --good: oklch(0.75 0.13 155); --good-bg: oklch(0.3 0.05 155);
    --bad: oklch(0.72 0.15 25); --bad-bg: oklch(0.31 0.06 25);
    --note-bg: oklch(0.3 0.03 85); --none-bg: oklch(0.26 0.008 262);
  }
  * { box-sizing: border-box; }
  body { background: var(--paper); color: var(--ink); font-family: var(--font-body); font-size: 16px; line-height: 1.7; word-break: keep-all; overflow-wrap: break-word; }
  .wrap { max-width: 64rem; margin: 0 auto; padding: 2rem 1.25rem 5rem; }
  .eyebrow { font-size: 0.72rem; letter-spacing: 0.14em; color: var(--brass); font-weight: 500; margin: 0 0 0.75rem; }
  h1 { font-family: var(--font-display); font-weight: 700; font-size: clamp(1.9rem, 5vw, 2.6rem); line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 1rem; text-wrap: balance; }
  .lede { max-width: var(--measure); color: var(--ink-2); font-size: 1.05rem; margin: 0 0 1.5rem; }
  .meta { display: flex; flex-wrap: wrap; gap: 0.3rem 1.5rem; font-size: 0.83rem; color: var(--ink-3); padding: 1rem 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
  .meta code { font-family: var(--font-mono); color: var(--ink-2); font-size: 0.8rem; }
  .tally { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: var(--rule); border: 1px solid var(--rule); margin: 2rem 0; max-width: 32rem; }
  .tally div { background: var(--paper-2); padding: 1rem 1.2rem; }
  .tally b { display: block; font-family: var(--font-display); font-size: 2rem; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .tally span { font-size: 0.8rem; color: var(--ink-3); letter-spacing: 0.06em; }
  .tally .pass b { color: var(--good); } .tally .fail b { color: var(--bad); } .tally .note b { color: var(--brass); }
  h2 { font-family: var(--font-display); font-size: 1.5rem; font-weight: 600; margin: 3rem 0 0.4rem; padding-top: 1.25rem; border-top: 2px solid var(--ink); text-wrap: balance; }
  .sub { color: var(--ink-2); margin: 0 0 1.25rem; max-width: var(--measure); }
  p { max-width: var(--measure); margin: 0 0 1rem; }
  ul { max-width: var(--measure); padding-left: 1.1rem; margin: 0 0 1.25rem; display: flex; flex-direction: column; gap: 0.45rem; }
  .scroll { overflow-x: auto; margin: 0 0 1.5rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  th, td { text-align: left; vertical-align: top; padding: 0.55rem 0.8rem 0.55rem 0; border-bottom: 1px solid var(--rule); }
  thead th { font-size: 0.74rem; letter-spacing: 0.06em; color: var(--ink-3); font-weight: 600; white-space: nowrap; }
  tr.area th { font-family: var(--font-display); font-size: 0.95rem; font-weight: 600; color: var(--navy); padding-top: 1.4rem; border-bottom: 1px solid var(--ink); }
  td.id { font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-3); white-space: nowrap; }
  td.st { white-space: nowrap; font-weight: 600; font-size: 0.8rem; }
  td.st.pass { color: var(--good); } td.st.fail { color: var(--bad); } td.st.note { color: var(--brass); }
  td.detail { color: var(--ink-2); font-size: 0.84rem; min-width: 22rem; }
  pre { font-family: var(--font-mono); font-size: 0.78rem; line-height: 1.55; background: var(--none-bg); padding: 0.9rem 1rem; overflow-x: auto; margin: 0 0 1.25rem; max-width: var(--measure); white-space: pre-wrap; word-break: break-all; }
  .kv { display: grid; grid-template-columns: 11rem minmax(0, 1fr); gap: 0.35rem 1rem; max-width: var(--measure); font-size: 0.92rem; margin: 0 0 1.25rem; }
  .kv dt { color: var(--ink-3); } .kv dd { margin: 0; }
  .finding { border-left: 3px solid var(--bad); padding: 0.1rem 0 0.1rem 1rem; margin: 0 0 1.5rem; max-width: var(--measure); }
  .finding.fixed { border-color: var(--good); }
  .finding b { display: block; margin-bottom: 0.2rem; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--rule); font-size: 0.82rem; color: var(--ink-3); }
  @media (max-width: 40rem) { .tally { grid-template-columns: 1fr 1fr 1fr; } .kv { grid-template-columns: 1fr; gap: 0.1rem 0; } .kv dt { margin-top: 0.5rem; } }
</style>

<div class="wrap">
  <p class="eyebrow">프로젝트12 통합관리 · 별하</p>
  <h1>검수 결과서</h1>
  <p class="lede">
    기획서의 검수 기준(8.2)과 단계별 범위(3.1)를 기준표로 삼아, 운영과 같은 빌드를 실제 브라우저와 실제 수신 서버에 대고 하나씩 돌려 본 기록입니다.
    자동 테스트가 흉내(mock)로 넘어가는 지점 — 메신저 웹훅과 알림톡 딜러 API로 실제 나가는 HTTP 요청, 서명된 HERO 수신, 파일 바이트 왕복, 배치 전달, 오프라인 복귀 — 을 진짜로 확인했습니다.
  </p>
  <div class="meta">
    <span>실행 <b>${ran}</b> (KST)</span>
    <span>코드 <code>${commit}</code></span>
    <span>대상 운영 빌드(standalone) · 검수 DB(2개 지점, 앱 전용 계정으로 RLS 적용)</span>
    <span>자동 테스트 단위·통합 240 · E2E 43 별도 통과</span>
  </div>

  <div class="tally">
    <div class="pass"><b>${pass}</b><span>통과</span></div>
    <div class="note"><b>${note}</b><span>참고</span></div>
    <div class="fail"><b>${fail}</b><span>실패</span></div>
  </div>

  <h2>발견한 것</h2>
  <p class="sub">첫 실행에서 나온 문제와 처리 결과입니다.</p>
  <div class="finding fixed">
    <b>메신저 웹훅 "라운딩 회차 완료" 이벤트가 발행되지 않음 — 고침</b>
    설정 화면에서 구독할 수 있는 세 이벤트 중 "라운딩 회차 완료"가 실제로는 어디서도 발행되지 않았습니다. 이슈 보고·고벌점은 정상이었습니다.
    회차 완료 시 회차·인원·벌점·이슈·부재 요약을 담아 발행하도록 고치고 회귀 테스트를 추가했습니다. 자동 테스트가 이슈·고벌점만 검사하고 있어서 잡히지 않았던 결함입니다.
  </div>
  <div class="finding">
    <b>회원 감사 로그에 연락처가 기록되지 않음 — 관찰</b>
    회원 수정 감사 로그의 이전·이후 값에 연락처 필드가 들어 있지 않아, 연락처 변경 이력은 남지 않습니다(마스킹은 다른 로그에서 동작). 개인정보 최소화 관점에서는 오히려 안전하지만, 연락처 변경 추적이 필요하면 마스킹된 값으로 남기도록 바꿀 수 있습니다.
  </div>
  <div class="finding">
    <b>회원 목록 CSV 내보내기 없음 — 관찰</b>
    기획서 커스텀 필드 검수 항목의 "CSV에 반영"은 내보내기 기능을 전제하는데, 현재는 CSV 이관(들여오기)만 있습니다. 필요하면 회원 목록 내보내기를 추가합니다.
  </div>

  <h2>검수 항목별 결과</h2>
  <p class="sub">항목 번호는 기획서 모듈 번호를 따릅니다. "참고"는 화면 존재만 확인하고 흐름은 자동 E2E가 검증하는 항목입니다.</p>
  <div class="scroll">
    <table>
      <thead><tr><th>번호</th><th>항목</th><th>결과</th><th>확인한 것</th></tr></thead>
      <tbody>${rows}
      </tbody>
    </table>
  </div>

  <h2>연동 증거</h2>
  <p class="sub">검수 중 로컬 수신 서버가 실제로 받은 요청입니다.</p>
  <dl class="kv">
    <dt>메신저 웹훅 수신</dt><dd>${Object.entries(webhookCounts).map(([k, v]) => `${esc(k)} ${v}건`).join(" · ") || "없음"}</dd>
    <dt>알림톡 딜러 API 호출</dt><dd>${alimtalkCalls.length}건 (Authorization: ${esc(alimtalkSample?.auth ?? "-")})</dd>
    <dt>배치 로그</dt><dd>${batch.length ? esc(batch.slice(0, 4).join(" / ")) : "없음"}</dd>
  </dl>
  <p>메신저 채널에 게시된 본문 (Slack·Mattermost·Rocket.Chat 인커밍 웹훅 호환 JSON):</p>
  <pre>${esc(JSON.stringify(webhookSample?.body ?? {}, null, 2))}</pre>
  <p>알림톡 딜러 API 로 나간 요청 본문 (범용 HTTP 어댑터. NHN Cloud·솔라피 어댑터는 계약 후 실계정으로 검증):</p>
  <pre>${esc(JSON.stringify(alimtalkSample?.body ?? {}, null, 2))}</pre>

  <h2>운영 서버 점검 (읽기 전용)</h2>
  <p class="sub">실데이터가 있는 운영 서버에는 기록을 남기지 않고 바깥에서 확인만 했습니다.</p>
  <dl class="kv">
    <dt>헬스체크</dt><dd>ok · db · timeZone Asia/Seoul · scheduler true</dd>
    <dt>HTTPS 강제</dt><dd>http → https 301, HSTS max-age 1년</dd>
    <dt>보안 헤더</dt><dd>CSP · X-Frame-Options · nosniff · Referrer-Policy · Permissions-Policy</dd>
    <dt>보호 경로</dt><dd>비로그인 /members → /login?next=/members (307)</dd>
    <dt>현황판 API</dt><dd>토큰 없이 401</dd>
    <dt>배치 API</dt><dd>시크릿 없이 outbox·alimtalk·retention 모두 401</dd>
    <dt>HERO 수신</dt><dd>서명 없이 503 (시크릿 미설정 상태 — 계약 후 설정)</dd>
    <dt>지점 격리(RLS)</dt><dd>앱 전용 비superuser 계정으로 접속, 다른 지점 컨텍스트에서 회원 0건 (배포 시 확인)</dd>
  </dl>

  <h2>백업·복구 리허설</h2>
  <p>
    <code>scripts/backup.sh</code>로 검수 DB를 덤프(120KB, 테이블 34개)한 뒤 빈 DB에 <code>pg_restore</code>로 복구해 회원 29명·체크 120건이 그대로 돌아오는 것을 확인했습니다.
    운영은 Railway Postgres 일일 스냅샷에 더해 같은 스크립트로 주 1회 별도 보관을 권장합니다.
  </p>

  <h2>다시 돌리는 법</h2>
  <p>이 검수는 저장소에 들어 있어 코드가 바뀔 때마다 같은 방식으로 반복할 수 있습니다.</p>
  <pre>pnpm build
sh scripts/acceptance/run.sh      # DB 초기화·시드 → 수신기·운영 빌드 기동 → 워크스루 → acceptance-out/
node scripts/acceptance/report.mjs acceptance-out</pre>

  <h2>이 검수가 보지 않은 것</h2>
  <ul>
    <li>알림톡 실제 딜러 계정(NHN Cloud·솔라피) — 어댑터는 있으나 계약·템플릿 승인 후 실계정으로 한 번 보내 봐야 합니다.</li>
    <li>사내 메신저 서버 설치 자체(RFP 3-3 별도 견적) — 인커밍 웹훅 수신까지만 확인했습니다.</li>
    <li>실기기(매장 태블릿·스마트폰)에서의 라운딩 — 브라우저 에뮬레이션(390×844, 터치)으로 확인했습니다.</li>
    <li>동시 사용자 부하 — 성능 점검(docs/04)은 대량 데이터 기준이며 동시 접속 부하 시험은 하지 않았습니다.</li>
  </ul>

  <footer>프로젝트12 통합관리 플랫폼 별하 · 검수 결과서 · 생성 ${ran} · 코드 ${commit}</footer>
</div>
`;
writeFileSync(outPath, html);
console.log(`${outPath} 생성 (통과 ${pass} · 참고 ${note} · 실패 ${fail})`);
