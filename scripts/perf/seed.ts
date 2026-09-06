/**
 * 성능 점검용 대량 시드. 반드시 별도 DB(byeolha_perf)에서 실행한다.
 *   DATABASE_URL=postgres://localhost:5432/byeolha_perf pnpm exec tsx scripts/perf/seed.ts
 * 규모: 지점 10 · 지점당 좌석 80 · 등록 회원 80(+상담 10) · 12주치 체크(일별 4항목 + 회차 12) ≈ 107만 건
 */
import { config } from "dotenv";
import { sql as raw } from "drizzle-orm";

config({ path: ".env.local" });

const BRANCHES = Number(process.env.PERF_BRANCHES ?? 10);
const SEATS = Number(process.env.PERF_SEATS ?? 80);
const WEEKS = Number(process.env.PERF_WEEKS ?? 12);
const ROUNDS = 12;
const BATCH = 3000;

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/perf/.test(url)) throw new Error("perf DB(byeolha_perf)에서만 실행하세요: " + url);
  const t0 = Date.now();
  const { db, getSql } = await import("../../src/db/client");
  const s = await import("../../src/db/schema");
  const { hashPassword } = await import("../../src/lib/auth/password");
  const { addDays, toDateKey, weekStart } = await import("../../src/lib/rules/week");

  const tables = await db.execute<{ tablename: string }>(raw`select tablename from pg_tables where schemaname = 'public'`);
  if (tables.length) await db.execute(raw.raw(`truncate table ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`));

  let seedState = 42;
  const rnd = () => {
    seedState = (seedState + 0x6d2b79f5) | 0;
    let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const pw = await hashPassword("1234");
  const [hq] = await db.insert(s.users).values({ loginId: "hq", name: "본사운영", passwordHash: pw, isHqAdmin: true }).returning();
  const rules = await db
    .insert(s.penaltyRules)
    .values([
      { name: "이동금지 위반", points: 5, sort: 1 },
      { name: "휴대폰 전원 미차단", points: 2, sort: 2 },
      { name: "무단 미등원", points: 8, sort: 3 },
      { name: "졸음", points: 3, sort: 4 },
      { name: "연속 졸음", points: 6, sort: 5 },
      { name: "지각", points: 4, sort: 6 },
    ])
    .returning();
  await db.insert(s.boardItems).values([
    { key: "attendance", label: "출석", kind: "daily", sort: 1 },
    { key: "planner", label: "플래너", kind: "daily", sort: 2 },
    { key: "round", label: "라운딩", kind: "round", sort: 3 },
    { key: "vocab", label: "영단어", kind: "daily", sort: 4 },
    { key: "checkout", label: "점검완료", kind: "daily", sort: 5 },
  ]);

  const today = toDateKey(new Date());
  const monday = weekStart(today);
  const firstDay = addDays(monday, -7 * (WEEKS - 1));
  const days: string[] = [];
  for (let d = 0; ; d++) {
    const k = toDateKey(addDays(firstDay, d));
    if (k > today) break;
    days.push(k);
  }
  const dailyKeys = ["attendance", "planner", "vocab", "checkout"];
  let totalChecks = 0;

  for (let b = 1; b <= BRANCHES; b++) {
    const code = `P${String(b).padStart(2, "0")}`;
    const [branch] = await db.insert(s.branches).values({ code, name: `성능지점${b}`, settings: { roundsPerDay: ROUNDS, maskNames: false } }).returning();
    const [manager] = await db.insert(s.users).values({ loginId: `mgr${b}`, name: `지점장${b}`, passwordHash: pw }).returning();
    const [mentor] = await db.insert(s.users).values({ loginId: `mentor${b}`, name: `멘토${b}`, passwordHash: pw }).returning();
    const [a1] = await db.insert(s.users).values({ loginId: `asst${b}a`, name: `조교${b}A`, passwordHash: pw }).returning();
    const [a2] = await db.insert(s.users).values({ loginId: `asst${b}b`, name: `조교${b}B`, passwordHash: pw }).returning();
    await db.insert(s.memberships).values([
      { userId: manager.id, branchId: branch.id, role: "branch_manager" },
      { userId: mentor.id, branchId: branch.id, role: "mentor" },
      { userId: a1.id, branchId: branch.id, role: "assistant" },
      { userId: a2.id, branchId: branch.id, role: "assistant" },
    ]);
    const seats = await db
      .insert(s.seats)
      .values(Array.from({ length: SEATS }, (_, i) => ({ branchId: branch.id, seatNo: i + 1, zone: i < 25 ? "A" : i < 50 ? "B" : "C", sort: i + 1 })))
      .returning();
    const members = await db
      .insert(s.members)
      .values([
        ...seats.map((seat, i) => ({
          branchId: branch.id,
          seatId: seat.id,
          name: `회원${b}-${i + 1}`,
          phone: `010-${String(1000 + b).padStart(4, "0")}-${String(i + 1).padStart(4, "0")}`,
          status: "enrolled" as const,
          focusCare: i % 6 === 0,
          track: ["문과", "이과", "예체능"][i % 3],
          school: `학교${(i % 7) + 1}`,
          grade: String((i % 3) + 1),
          fieldNote: i % 5 === 0 ? "매주 화 17시 학원 조퇴" : null,
        })),
        ...Array.from({ length: 10 }, (_, i) => ({ branchId: branch.id, seatId: null, name: `상담${b}-${i + 1}`, status: "prospect" as const, focusCare: false })),
      ])
      .returning({ id: s.members.id, seatId: s.members.seatId, status: s.members.status, focusCare: s.members.focusCare });
    const enrolled = members.filter((m) => m.status === "enrolled");
    const seatNoOf = new Map(seats.map((x) => [x.id, x.seatNo]));

    // 세션
    const sessionRows: (typeof s.roundingSessions.$inferInsert)[] = [];
    for (const day of days) {
      const n = day === today ? 3 : ROUNDS;
      for (let r = 1; r <= n; r++) sessionRows.push({ branchId: branch.id, date: day, roundNo: r, startedBy: r % 2 ? a1.id : a2.id, completedAt: day === today && r === n ? null : new Date() });
    }
    const sessions = await db.insert(s.roundingSessions).values(sessionRows).returning({ id: s.roundingSessions.id, date: s.roundingSessions.date, roundNo: s.roundingSessions.roundNo, completedAt: s.roundingSessions.completedAt });
    const sessionByKey = new Map(sessions.map((x) => [`${x.date}|${x.roundNo}`, x]));

    // 체크 (배치 insert)
    let buf: (typeof s.checks.$inferInsert)[] = [];
    const flush = async () => {
      if (buf.length) {
        await db.insert(s.checks).values(buf);
        totalChecks += buf.length;
        buf = [];
      }
    };
    for (const day of days) {
      for (const m of enrolled) {
        const seatNo = m.seatId ? (seatNoOf.get(m.seatId) ?? null) : null;
        for (const key of dailyKeys) {
          const r = rnd();
          const grade = r < 0.9 ? "a" : r < 0.97 ? "b" : "p";
          const rule = grade === "p" ? rules[Math.floor(rnd() * rules.length)] : null;
          buf.push({ branchId: branch.id, memberId: m.id, seatNoSnapshot: seatNo, date: day, itemKey: key, roundNo: 0, grade, points: rule?.points ?? 0, penaltyRuleId: rule?.id ?? null, createdBy: a1.id });
        }
        for (let r = 1; r <= ROUNDS; r++) {
          const sess = sessionByKey.get(`${day}|${r}`);
          if (!sess || sess.completedAt === null) continue;
          const x = rnd();
          const grade = x < 0.88 ? "a" : x < 0.96 ? "b" : "p";
          const rule = grade === "p" ? rules[Math.floor(rnd() * rules.length)] : null;
          buf.push({ branchId: branch.id, memberId: m.id, seatNoSnapshot: seatNo, date: day, itemKey: "round", roundNo: r, sessionId: sess.id, grade, points: rule?.points ?? 0, penaltyRuleId: rule?.id ?? null, isIssue: grade === "p" && (rule?.points ?? 0) >= 5 && rnd() < 0.3, createdBy: a1.id });
        }
        if (buf.length >= BATCH) await flush();
      }
    }
    await flush();

    // 상담일지: 회원 × 주차
    const logs: (typeof s.counselLogs.$inferInsert)[] = [];
    for (let w = 0; w < WEEKS; w++) {
      const ws = toDateKey(addDays(monday, -7 * w));
      for (const m of enrolled) {
        if (rnd() < 0.15) continue;
        logs.push({ branchId: branch.id, memberId: m.id, logType: "weekly", periodDate: ws, issueText: "국어 실전연습 부족. 수학 오답 정리 필요", issueBy: manager.id, issueAt: new Date(), resolutionText: rnd() < 0.6 ? "기출 2세트 과제 부여" : null, resolutionBy: rnd() < 0.6 ? mentor.id : null });
      }
    }
    for (let i = 0; i < logs.length; i += BATCH) await db.insert(s.counselLogs).values(logs.slice(i, i + BATCH));

    // 이슈 몇 건
    await db.insert(s.issues).values(
      enrolled.slice(0, 8).map((m, i) => ({
        branchId: branch.id,
        memberId: m.id,
        source: "rounding",
        title: `회원${b}-${i + 1} · 이동금지 위반`,
        severity: i % 3 ? "normal" : "high",
        status: (i % 4 === 0 ? "resolved" : "open") as "resolved" | "open",
        reportedBy: a1.id,
        assignedTo: manager.id,
      })),
    );

    console.log(`${code} 완료 · 누적 체크 ${totalChecks.toLocaleString()}건 · ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  void hq;
  await db.execute(raw`analyze`);
  console.log(`시드 완료: 지점 ${BRANCHES}, 회원 ${BRANCHES * (SEATS + 10)}, 체크 ${totalChecks.toLocaleString()}건, ${Math.round((Date.now() - t0) / 1000)}s`);
  await getSql().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
