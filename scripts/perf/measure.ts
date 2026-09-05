/**
 * 핵심 조회의 서버 측 처리 시간을 잰다 (DB 왕복 포함, HTTP·렌더링 제외).
 *   DATABASE_URL=postgres://localhost:5432/byeolha_perf pnpm exec tsx scripts/perf/measure.ts
 */
import { config } from "dotenv";
import { eq } from "drizzle-orm";

config({ path: ".env.local" });

const N = Number(process.env.PERF_N ?? 7);

function stats(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { p50: Math.round(p(0.5)), p95: Math.round(p(0.95)), max: Math.round(s[s.length - 1]) };
}

async function bench(name: string, fn: () => Promise<unknown>) {
  await fn(); // 워밍업
  const times: number[] = [];
  let size = 0;
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    const r = await fn();
    times.push(performance.now() - t);
    if (i === 0) size = JSON.stringify(r ?? "").length;
  }
  const st = stats(times);
  console.log(`${name.padEnd(34)} p50 ${String(st.p50).padStart(5)}ms  p95 ${String(st.p95).padStart(5)}ms  max ${String(st.max).padStart(5)}ms  payload ${(size / 1024).toFixed(0).padStart(5)}KB`);
  return st;
}

async function main() {
  const { db, sql } = await import("../../src/db/client");
  const s = await import("../../src/db/schema");
  const { buildCtx } = await import("../../src/lib/auth/ctx");
  const { todayKey, toDateKey, weekStart, addDays } = await import("../../src/lib/rules/week");
  const { listMembers, getMember, memberTimeline } = await import("../../src/modules/members/repo");
  const { weeklyGrid } = await import("../../src/modules/counsel/repo");
  const { boardData } = await import("../../src/modules/board/repo");
  const { dashboard, hqOverview } = await import("../../src/modules/dashboard/repo");
  const { dayHistory, sessionSheet, todaySessions, memberWeek } = await import("../../src/modules/rounding/repo");
  const { listIssues } = await import("../../src/modules/issues/repo");
  const { monthGrid, monthlySettlement } = await import("../../src/modules/meals/repo");

  const [mgr] = await db.select().from(s.users).where(eq(s.users.loginId, "mgr1"));
  const [hqUser] = await db.select().from(s.users).where(eq(s.users.loginId, "hq"));
  const ctx = (await buildCtx(mgr.id, null))!;
  const hqCtx = (await buildCtx(hqUser.id, ctx.branchId))!;
  const today = todayKey();
  const ws = toDateKey(weekStart(today));
  const weeks = [-3, -2, -1, 0].map((i) => toDateKey(addDays(ws, i * 7)));
  const [{ n: checkCount }] = await db.execute<{ n: string }>((await import("drizzle-orm")).sql`select count(*)::text as n from checks`);
  const members = await listMembers(ctx);
  const sessions = await todaySessions(ctx, today);
  console.log(`지점 ${ctx.branchName} · 회원 ${members.length} · 전체 체크 ${Number(checkCount).toLocaleString()}건 · 반복 ${N}회\n`);

  const results: Record<string, { p50: number; p95: number; max: number }> = {};
  results["현황판 boardData(주간)"] = await bench("현황판 boardData(주간)", () => boardData(ctx.branchId, today));
  results["주간 상담 그리드 weeklyGrid(4주)"] = await bench("주간 상담 그리드 weeklyGrid(4주)", () => weeklyGrid(ctx, weeks));
  results["회원 목록 listMembers"] = await bench("회원 목록 listMembers", () => listMembers(ctx));
  results["회원 상세 getMember"] = await bench("회원 상세 getMember", () => getMember(ctx, members[0].id));
  results["회원 타임라인 memberTimeline"] = await bench("회원 타임라인 memberTimeline", () => memberTimeline(ctx, members[0].id));
  results["회원 주간 memberWeek"] = await bench("회원 주간 memberWeek", () => memberWeek(ctx, members[0].id, ws));
  results["대시보드 dashboard"] = await bench("대시보드 dashboard", () => dashboard(ctx, today));
  results["본사 전 지점 hqOverview"] = await bench("본사 전 지점 hqOverview", () => hqOverview(hqCtx, today));
  results["라운딩 회차 시트 sessionSheet"] = await bench("라운딩 회차 시트 sessionSheet", () => sessionSheet(ctx, sessions[0].id));
  results["라운딩 일별 조회 dayHistory"] = await bench("라운딩 일별 조회 dayHistory", () => dayHistory(ctx, toDateKey(addDays(today, -1))));
  results["이슈 목록 listIssues"] = await bench("이슈 목록 listIssues", () => listIssues(ctx));
  results["식사 월 그리드 monthGrid"] = await bench("식사 월 그리드 monthGrid", () => monthGrid(ctx, today.slice(0, 7)));
  results["식사 월 정산 monthlySettlement"] = await bench("식사 월 정산 monthlySettlement", () => monthlySettlement(ctx, today.slice(0, 7)));

  const slow = Object.entries(results).filter(([, r]) => r.p95 > 1000);
  console.log(`\n목표: p95 1초 이내. 초과 ${slow.length}건${slow.length ? ": " + slow.map(([k]) => k).join(", ") : ""}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
