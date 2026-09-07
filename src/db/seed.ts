/**
 * 개발용 시드. `pnpm seed`
 * - 기존 데이터를 모두 지우고 다시 넣는다 (dev DB 전용)
 * - 실제 인물 정보는 넣지 않는다. 이름·연락처는 모두 가상이다.
 */
import { createHash, randomBytes } from "node:crypto";
import { config } from "dotenv";
import { sql as raw } from "drizzle-orm";

config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (/prod/i.test(url)) throw new Error("운영 DB에는 시드를 실행하지 않습니다");

  const { db, getSql } = await import("./client");
  const s = await import("./schema");
  const { hashPassword } = await import("@/lib/auth/password");
  const { addDays, toDateKey, weekStart } = await import("@/lib/rules/week");

  // ----- 초기화 -----
  const tables = await db.execute<{ tablename: string }>(
    raw`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (tables.length) {
    await db.execute(raw.raw(`truncate table ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`));
  }

  // 결정적 난수 (재실행해도 같은 데이터)
  let seedState = 20260905;
  const rnd = () => {
    seedState |= 0;
    seedState = (seedState + 0x6d2b79f5) | 0;
    let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

  // ----- 지점 -----
  const boardTokenPlain = randomBytes(16).toString("hex");
  const boardTokenHash = createHash("sha256").update(boardTokenPlain).digest("hex");
  const roundSchedule = ["09:00", "10:00", "11:00", "12:00", "13:30", "14:30", "15:30", "16:30", "17:30", "19:00", "20:00", "21:00"];
  const [dt2] = await db
    .insert(s.branches)
    .values({ code: "DT2", name: "동탄2", settings: { roundsPerDay: 12, maskNames: false, roundSchedule }, boardTokenHash })
    .returning();
  const [sw1] = await db
    .insert(s.branches)
    .values({ code: "SW1", name: "수원1", settings: { roundsPerDay: 10, maskNames: true, roundSchedule: roundSchedule.slice(0, 10) } })
    .returning();

  // ----- 사용자 -----
  const pw = await hashPassword("1234");
  const pwHq = await hashPassword("hq1234");
  const [hq] = await db.insert(s.users).values({ loginId: "hq", name: "본사운영", passwordHash: pwHq, isHqAdmin: true }).returning();
  const [manager] = await db.insert(s.users).values({ loginId: "manager", name: "박원장", passwordHash: pw }).returning();
  const [mentor] = await db.insert(s.users).values({ loginId: "mentor", name: "이멘토", passwordHash: pw }).returning();
  const [assistant] = await db.insert(s.users).values({ loginId: "assistant", name: "최조교", passwordHash: pw, pinHash: await hashPassword("1111") }).returning();
  const [assistant2] = await db.insert(s.users).values({ loginId: "assistant2", name: "정조교", passwordHash: pw, pinHash: await hashPassword("2222") }).returning();
  const [manager2] = await db.insert(s.users).values({ loginId: "manager2", name: "김원장", passwordHash: pw }).returning();
  await db.insert(s.memberships).values([
    { userId: manager.id, branchId: dt2.id, role: "branch_manager" },
    { userId: mentor.id, branchId: dt2.id, role: "mentor" },
    { userId: assistant.id, branchId: dt2.id, role: "assistant" },
    { userId: assistant2.id, branchId: dt2.id, role: "assistant" },
    { userId: manager2.id, branchId: sw1.id, role: "branch_manager" },
    { userId: mentor.id, branchId: sw1.id, role: "mentor" },
  ]);

  // ----- 좌석 -----
  const zoneOf = (n: number) => (n <= 12 ? "A" : n <= 30 ? "B" : "C");
  const dt2Seats = await db
    .insert(s.seats)
    .values(Array.from({ length: 50 }, (_, i) => ({ branchId: dt2.id, seatNo: i + 1, zone: zoneOf(i + 1), sort: i + 1 })))
    .returning();
  const sw1Seats = await db
    .insert(s.seats)
    .values(Array.from({ length: 20 }, (_, i) => ({ branchId: sw1.id, seatNo: i + 1, zone: "A", sort: i + 1 })))
    .returning();
  const seatByNo = new Map(dt2Seats.map((x) => [x.seatNo, x]));

  // ----- 설정: 벌점 규칙 · 현황판 항목 (본사 기본) -----
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
  const ruleByName = new Map(rules.map((r) => [r.name, r]));
  await db.insert(s.boardItems).values([
    { key: "attendance", label: "출석", kind: "daily", sort: 1 },
    { key: "planner", label: "플래너", kind: "daily", sort: 2 },
    { key: "round", label: "라운딩", kind: "round", sort: 3 },
    { key: "vocab", label: "영단어", kind: "daily", sort: 4 },
    { key: "checkout", label: "점검완료", kind: "daily", sort: 5 },
  ]);

  // ----- 회원 (가상) -----
  const names = [
    "강하늘", "고은별", "구민재", "나윤서", "도현우", "류지안", "문서연", "배준혁", "서지우", "신예린",
    "안도윤", "오하린", "유시온", "임채원", "장태오", "전소율", "조아인", "한지호", "홍다은", "황민준",
    "표수아", "탁현서", "마이현", "노건우",
  ];
  const schools = ["한빛고", "샛별고", "은하고", "가온고", "누리고"];
  const tracks = ["문과", "이과", "이과", "문과", "예체능"];
  const fieldNotes = [null, null, null, "매주 화 17시 학원 조퇴", "월수금 19시 등원", null, "12시 30분 점심 외출", null];
  const today = toDateKey(new Date());
  const monday = weekStart(today);
  const mondayKey = toDateKey(monday);

  type NewMember = typeof s.members.$inferInsert;
  const memberRows: NewMember[] = names.map((name, i) => {
    const idx = i + 1;
    // 1~20 등록(좌석 1~10, 12~21), 21~22 상담, 23~24 퇴원
    const status: NewMember["status"] = idx <= 20 ? "enrolled" : idx <= 22 ? "prospect" : "withdrawn";
    const seatNo = idx <= 10 ? idx : idx <= 20 ? idx + 1 : null;
    const adult = idx % 7 === 0;
    return {
      branchId: dt2.id,
      seatId: status === "enrolled" && seatNo ? seatByNo.get(seatNo)!.id : null,
      name,
      phone: `010-0000-${String(100 + idx).padStart(4, "0")}`,
      birthDate: adult ? `2006-0${(idx % 9) + 1}-1${idx % 9}` : `2008-0${(idx % 9) + 1}-0${(idx % 9) + 1}`,
      gender: idx % 2 === 0 ? "여" : "남",
      memberKind: adult ? "adult" : "student",
      studentType: adult ? "N수생" : idx % 11 === 0 ? "검정고시" : "재학생",
      school: adult ? null : pick(schools),
      grade: adult ? null : String((idx % 3) + 1),
      track: tracks[idx % tracks.length],
      target: idx % 4 === 0 ? "한밭대 컴퓨터공학" : null,
      address: `경기 화성시 동탄대로 ${idx}`,
      status,
      focusCare: [1, 5, 9, 13, 17].includes(idx),
      firstRegisteredAt: idx <= 20 ? toDateKey(addDays(today, -60 - idx)) : null,
      firstCounseledAt: toDateKey(addDays(today, -65 - idx)),
      fieldNote: fieldNotes[idx % fieldNotes.length],
      memo: idx % 6 === 0 ? "국어 실전연습 보강 필요" : null,
    };
  });
  const members = await db.insert(s.members).values(memberRows).returning();

  await db.insert(s.memberGuardians).values(
    members
      .filter((m) => m.memberKind === "student")
      .map((m, i) => ({ memberId: m.id, name: `${m.name.slice(0, 1)}보호자`, relation: i % 3 === 0 ? "부" : "모", phone: `010-0000-${String(500 + i).padStart(4, "0")}` })),
  );
  await db.insert(s.memberEnrollments).values(
    members
      .filter((m) => m.status !== "prospect")
      .map((m, i) => {
        const short = i === 2 || i === 6;
        const start = short ? toDateKey(addDays(today, -18)) : toDateKey(addDays(today, -35));
        const end = m.status === "withdrawn" ? toDateKey(addDays(today, -5)) : short ? toDateKey(addDays(today, 15)) : toDateKey(addDays(today, 5 + (i % 4) * 10));
        return { memberId: m.id, startDate: start, endDate: end, planType: short ? "short" : "regular", note: short ? "단기 33일" : null };
      }),
  );

  // 수원1 회원 몇 명
  const sw1Members = await db
    .insert(s.members)
    .values(["백서준", "권나래", "송이안", "민유진", "하준서"].map((name, i) => ({
      branchId: sw1.id,
      seatId: sw1Seats[i].id,
      name,
      phone: `010-0000-${String(900 + i).padStart(4, "0")}`,
      status: "enrolled" as const,
      track: "문과",
      school: "수원고",
      grade: "3",
    })))
    .returning();
  void sw1Members;

  // ----- 이번 주 라운딩 세션 · 체크 (동탄2) -----
  const enrolled = members.filter((m) => m.status === "enrolled");
  const seatNoOf = (m: (typeof members)[number]) => dt2Seats.find((x) => x.id === m.seatId)?.seatNo ?? null;
  const dailyKeys = ["attendance", "planner", "vocab", "checkout"];
  const penaltyRuleNames = ["졸음", "휴대폰 전원 미차단", "지각", "이동금지 위반"];
  const issueCandidates: { checkId: string; memberId: string; name: string; rule: string }[] = [];

  for (let d = 0; d < 7; d++) {
    const dayKey = toDateKey(addDays(monday, d));
    if (dayKey > today) break;
    const isToday = dayKey === today;
    const roundsToday = isToday ? 3 : 12;
    // 세션
    const sessions = await db
      .insert(s.roundingSessions)
      .values(
        Array.from({ length: roundsToday }, (_, i) => ({
          branchId: dt2.id,
          date: dayKey,
          roundNo: i + 1,
          startedBy: i % 2 === 0 ? assistant.id : assistant2.id,
          completedAt: isToday && i === roundsToday - 1 ? null : new Date(),
        })),
      )
      .returning();
    const checkRows: (typeof s.checks.$inferInsert)[] = [];
    for (const m of enrolled) {
      const seatNo = seatNoOf(m);
      for (const key of dailyKeys) {
        const r = rnd();
        const grade = r < 0.88 ? "a" : r < 0.96 ? "b" : "p";
        const rule = grade === "p" && key === "attendance" ? ruleByName.get("지각")! : grade === "p" ? ruleByName.get("휴대폰 전원 미차단")! : null;
        checkRows.push({ branchId: dt2.id, memberId: m.id, seatNoSnapshot: seatNo, date: dayKey, itemKey: key, roundNo: 0, grade, points: rule?.points ?? 0, penaltyRuleId: rule?.id ?? null, createdBy: assistant.id });
      }
      for (const sess of sessions) {
        if (sess.completedAt === null) continue; // 진행 중 회차는 미입력
        const r = rnd();
        const grade = r < 0.86 ? "a" : r < 0.95 ? "b" : "p";
        const rule = grade === "p" ? ruleByName.get(pick(penaltyRuleNames))! : null;
        checkRows.push({ branchId: dt2.id, memberId: m.id, seatNoSnapshot: seatNo, date: dayKey, itemKey: "round", roundNo: sess.roundNo, sessionId: sess.id, grade, points: rule?.points ?? 0, penaltyRuleId: rule?.id ?? null, note: grade === "b" ? "학원 일정" : null, isIssue: grade === "p" && rule?.name === "이동금지 위반", createdBy: sess.startedBy });
      }
    }
    const inserted = await db.insert(s.checks).values(checkRows).returning({ id: s.checks.id, memberId: s.checks.memberId, isIssue: s.checks.isIssue, penaltyRuleId: s.checks.penaltyRuleId });
    for (const c of inserted) {
      if (c.isIssue) {
        const m = enrolled.find((x) => x.id === c.memberId)!;
        issueCandidates.push({ checkId: c.id, memberId: m.id, name: m.name, rule: rules.find((r) => r.id === c.penaltyRuleId)!.name });
      }
    }
  }

  // ----- 이슈 · 알림 -----
  const issueRows = issueCandidates.slice(0, 3).map((c, i) => ({
    branchId: dt2.id,
    memberId: c.memberId,
    source: "rounding",
    checkId: c.checkId,
    title: `${c.name} · ${c.rule}`,
    body: "라운딩 중 이동금지 시간에 자리를 비움",
    severity: i === 0 ? "high" : "normal",
    status: (i === 2 ? "resolved" : "open") as "open" | "resolved",
    reportedBy: assistant.id,
    assignedTo: manager.id,
    resolvedAt: i === 2 ? new Date() : null,
  }));
  if (issueRows.length) {
    const issues = await db.insert(s.issues).values(issueRows).returning();
    await db.insert(s.notifications).values(
      issues.filter((x) => x.status === "open").map((x) => ({ userId: manager.id, branchId: dt2.id, type: "issue", payload: { issueId: x.id, title: x.title } })),
    );
  }

  // ----- 집중관리일지 -----
  const lastMonday = toDateKey(addDays(monday, -7));
  const counselRows: (typeof s.counselLogs.$inferInsert)[] = [];
  enrolled.slice(0, 12).forEach((m, i) => {
    counselRows.push({
      branchId: dt2.id,
      memberId: m.id,
      logType: "weekly",
      periodDate: lastMonday,
      issueText: i % 2 === 0 ? "국어 실전연습이 부족함. 수학은 오답 정리 습관 필요" : "플래너 작성이 형식적임",
      issueBy: manager.id,
      issueAt: new Date(),
      resolutionText: i % 3 === 0 ? "국어 기출 2세트 주간 과제로 부여, 오답노트 양식 전달" : null,
      resolutionBy: i % 3 === 0 ? mentor.id : null,
      resolutionAt: i % 3 === 0 ? new Date() : null,
    });
    if (i < 6) {
      counselRows.push({
        branchId: dt2.id,
        memberId: m.id,
        logType: "weekly",
        periodDate: mondayKey,
        issueText: "지난주 과제 이행률 확인 필요",
        issueBy: manager.id,
        issueAt: new Date(),
      });
    }
  });
  for (const m of enrolled.filter((x) => x.focusCare)) {
    for (let d = 1; d <= 3; d++) {
      counselRows.push({
        branchId: dt2.id,
        memberId: m.id,
        logType: "focus_daily",
        periodDate: toDateKey(addDays(today, -d)),
        issueText: d === 1 ? "오늘은 단어 암기 양이 적음" : null,
        issueBy: d === 1 ? manager.id : null,
        issueAt: d === 1 ? new Date() : null,
        resolutionText: "영단어 30개 추가 테스트 진행, 통과",
        resolutionBy: mentor.id,
        resolutionAt: new Date(),
      });
    }
  }
  const logs = await db.insert(s.counselLogs).values(counselRows).returning();
  await db.insert(s.counselComments).values([
    { logId: logs[0].id, authorId: mentor.id, body: "@박원장 이번 주 상담 때 학부모 통화 부탁드립니다" },
    { logId: logs[0].id, authorId: manager.id, body: "네, 목요일에 통화하겠습니다" },
  ]);

  // ----- 2단계: 식사 · 근무 · 알림톡 템플릿 -----
  await db.insert(s.mealSettings).values({ branchId: dt2.id, lunchPrice: 8000, dinnerPrice: 8000, vendorName: "행복도시락", vendorPhone: "031-000-0000" });
  const mealRows: (typeof s.mealOrders.$inferInsert)[] = [];
  for (let d = 0; d < 14; d++) {
    const dayKey = toDateKey(addDays(monday, d));
    const dow = addDays(monday, d).getDay();
    if (dow === 0) continue;
    for (const m of enrolled.slice(0, 12)) {
      if (rnd() < 0.6) mealRows.push({ branchId: dt2.id, memberId: m.id, date: dayKey, meal: "lunch", ordered: true, priceSnapshot: 8000, changedBy: assistant.id });
      if (dow !== 6 && rnd() < 0.5) mealRows.push({ branchId: dt2.id, memberId: m.id, date: dayKey, meal: "dinner", ordered: true, priceSnapshot: 8000, changedBy: assistant.id });
    }
  }
  if (mealRows.length) await db.insert(s.mealOrders).values(mealRows);

  const slotRows = [
    { key: "t1", label: "1타임", startTime: "09:00", endTime: "09:30", hours: 50, weekend: false, sort: 1 },
    { key: "t2", label: "2타임", startTime: "09:30", endTime: "10:30", hours: 100, weekend: false, sort: 2 },
    { key: "t3", label: "3타임", startTime: "10:30", endTime: "12:00", hours: 150, weekend: false, sort: 3 },
    { key: "t4", label: "4타임", startTime: "13:00", endTime: "15:00", hours: 200, weekend: false, sort: 4 },
    { key: "t5", label: "5타임", startTime: "15:00", endTime: "17:00", hours: 200, weekend: false, sort: 5 },
    { key: "t6", label: "6타임", startTime: "17:00", endTime: "19:00", hours: 200, weekend: false, sort: 6 },
    { key: "t7", label: "7타임", startTime: "19:00", endTime: "22:00", hours: 300, weekend: false, sort: 7 },
    { key: "w1", label: "일1타임", startTime: "10:00", endTime: "14:00", hours: 400, weekend: true, sort: 8 },
    { key: "w2", label: "일2타임", startTime: "14:00", endTime: "18:00", hours: 400, weekend: true, sort: 9 },
  ];
  await db.insert(s.shiftSlots).values(slotRows.map((r) => ({ ...r, branchId: dt2.id })));
  await db.insert(s.staffProfiles).values([
    { userId: assistant.id, branchId: dt2.id, employmentType: "주간조교", hourlyRate: 10500, workDays: "월~수" },
    { userId: assistant2.id, branchId: dt2.id, employmentType: "야간조교", hourlyRate: 10500, workDays: "목~일" },
    { userId: mentor.id, branchId: dt2.id, employmentType: "컨설팅", hourlyRate: 25000, workDays: "화·목·토" },
    { userId: manager.id, branchId: dt2.id, employmentType: "원장", hourlyRate: null, workDays: "월~금" },
  ]);
  const workRows: (typeof s.workLogs.$inferInsert)[] = [];
  for (let d = 0; d < 6; d++) {
    const dayKey = toDateKey(addDays(monday, d));
    if (dayKey >= today) break;
    const keys = d < 3 ? ["t1", "t2", "t3"] : ["t4", "t5", "t6"];
    workRows.push({ branchId: dt2.id, userId: assistant.id, date: dayKey, slotKeys: keys, hoursX100: keys.reduce((a, k) => a + (slotRows.find((r) => r.key === k)?.hours ?? 0), 0), overtimeX100: d === 1 ? 50 : 0, overtimeReason: d === 1 ? "외출 확인, 남자 화장실 정리" : null, hqConfirmedBy: d < 2 ? hq.id : null, hqConfirmedAt: d < 2 ? new Date() : null });
    workRows.push({ branchId: dt2.id, userId: assistant2.id, date: dayKey, slotKeys: ["t7"], hoursX100: 300, overtimeX100: 0 });
  }
  if (workRows.length) await db.insert(s.workLogs).values(workRows);

  await db.insert(s.alimtalkTemplates).values([
    { code: "WEEKLY_REPORT", name: "주간리포트 안내", body: "#{이름} 학생의 #{지점} 주간리포트가 도착했습니다.\n#{링크}", variables: ["이름", "지점", "링크"] },
    { code: "NOTICE", name: "공지", body: "[#{지점}] #{내용}", variables: ["지점", "내용"] },
    { code: "MEAL_BILL", name: "식사비 안내", body: "#{이름} 학생의 #{월} 식사비는 #{금액}원입니다. 확인 부탁드립니다.", variables: ["이름", "월", "금액"] },
  ]);

  console.log("시드 완료");
  console.log("  계정: hq/hq1234 (본사), manager/1234 (지점장 동탄2), mentor/1234 (멘토), assistant/1234 (조교), manager2/1234 (지점장 수원1)");
  console.log(`  현황판(동탄2): /board/${dt2.id}?t=${boardTokenPlain}`);
  console.log(`  회원 ${members.length}명, 좌석 ${dt2Seats.length}석, 사용자 ${[hq, manager, mentor, assistant, assistant2, manager2].length}명`);
  await getSql().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
