/**
 * 지점 구글시트 5종(xlsx)을 플랫폼 DB 로 그대로 적재한다.
 *   pnpm exec tsx scripts/migrate-sheets.ts --branch DT2 --dir ~/Downloads \
 *     --members "고객정보시트_프로젝트12_동탄2.xlsx" --counsel "(동탄) 집중관리일지 -2026.07.xlsx" \
 *     --board "게시용 회원생활관리 시트_프로젝트12_동탄2.xlsx" --meals "식사 주문시트_프로젝트12(2026)_동탄2.xlsx" \
 *     --worklog "조교근무일지(2026)_ 동탄2.xlsx"
 *
 * - 지점의 기존 업무 데이터(회원·좌석·체크·상담·식사·모의고사·근무)를 지우고 다시 넣는다(재실행 가능). 사용자 계정·설정은 유지.
 * - 시트에 있는 값은 해석 없이 최대한 보존한다. 뜻을 모르는 표기는 메모에 남긴다.
 * - 실명·연락처는 출력하지 않는다.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db/client";
import * as s from "@/db/schema";
import { buildCtx } from "@/lib/auth/ctx";
import { hashPassword } from "@/lib/auth/password";
import { autoMapHeaders, commitImport, previewImport } from "@/modules/members/import";

// ---------- 인자 ----------
const argv = process.argv.slice(2);
const opt = (k: string, d = ""): string => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const branchCode = opt("branch", "DT2");
const dir = opt("dir", ".").replace(/^~/, process.env.HOME ?? "");
const files = {
  members: opt("members"),
  counsel: opt("counsel"),
  board: opt("board"),
  meals: opt("meals"),
  worklog: opt("worklog"),
};
const today = opt("today", new Date().toISOString().slice(0, 10));
const path = (f: string) => (f ? (f.startsWith("/") ? f : join(dir, f)) : "");

// ---------- xlsx 읽기 ----------
type Grid = string[][];
/** 날짜 셀은 YYYY-MM-DD, 숫자·불리언은 문자열로 통일한다 (구글 xlsx 는 서식 문자열이 없어 raw 값을 직접 다룬다) */
function fmt(c: unknown): string {
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${c.getFullYear()}-${p(c.getMonth() + 1)}-${p(c.getDate())}`;
  }
  if (typeof c === "number") return Number.isInteger(c) ? String(c) : String(Math.round(c * 100) / 100);
  return String(c ?? "").trim();
}
function readBook(file: string): Record<string, Grid> {
  if (!existsSync(file)) throw new Error(`파일이 없습니다: ${file}`);
  const wb = XLSX.readFile(file, { cellDates: true });
  const out: Record<string, Grid> = {};
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    out[name] = rows.map((r) => r.map(fmt));
  }
  return out;
}
const cell = (g: Grid, r: number, c: number) => (g[r]?.[c] ?? "").trim();
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}/.test(v);
const dateOf = (v: string) => v.slice(0, 10);
const num = (v: string) => {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const truthy = (v: string) => /^(true|o|y|1|예|○|◯|v)$/i.test(v);
const log = (...a: unknown[]) => console.log(...a);

// ---------- 이름 매칭 ----------
const cleanName = (raw: string) => raw.replace(/\s+/g, "").replace(/\/.*$/, "");
type IndexRow = { id: string; status: string; seatNo: number | null };
class MemberIndex {
  byName = new Map<string, IndexRow[]>();
  /** 대소문자만 다른 표기(김민지b → 김민지B)를 붙이기 위한 색인 */
  byLower = new Map<string, IndexRow[]>();
  /** 고객정보 시트에 없는 동명이인(B 이상)으로 새로 만든 이름. 고객 확인용으로 모아 둔다 */
  newDistinct = new Set<string>();
  created = 0;
  constructor(private branchId: string) {}
  async load() {
    const rows = await db
      .select({ id: s.members.id, name: s.members.name, status: s.members.status, seatNo: s.seats.seatNo })
      .from(s.members)
      .leftJoin(s.seats, eq(s.seats.id, s.members.seatId))
      .where(eq(s.members.branchId, this.branchId));
    this.byName.clear();
    this.byLower.clear();
    for (const r of rows) {
      const n = cleanName(r.name);
      this.byName.set(n, [...(this.byName.get(n) ?? []), r]);
      this.byLower.set(n.toLowerCase(), [...(this.byLower.get(n.toLowerCase()) ?? []), r]);
    }
  }
  /**
   * 이름(+좌석)으로 찾고, 없으면 퇴원 상태의 자리표시 회원을 만든다.
   *
   * 동명이인 표기 규칙: 시트는 같은 이름 두 사람을 'A'/'B'로 구분하고, 고객정보 시트에는
   * 첫 번째가 접미사 없이(김민지), 두 번째가 B를 달고(김민지B) 등록돼 있다.
   * 따라서 A 는 접미사 없는 사람을 가리키므로 떼고, B 이상은 다른 사람이므로 절대 합치지 않는다.
   * (예전에는 끝 영문자를 무조건 떼어 김지민B 의 기록이 김지민에게 붙었다)
   */
  async resolve(rawName: string, seatNo: number | null, note: string): Promise<string | null> {
    const name = cleanName(rawName);
    if (!name || /^(합계|체험|오류)$/.test(name)) return null;
    let cands = this.byName.get(name) ?? this.byLower.get(name.toLowerCase()) ?? [];
    if (!cands.length && /[Aa]$/.test(name)) {
      const base = name.slice(0, -1);
      cands = this.byName.get(base) ?? this.byLower.get(base.toLowerCase()) ?? [];
    }
    if (!cands.length && /[B-Zb-z]$/.test(name) && /^[가-힣]{2,4}[A-Za-z]$/.test(name)) this.newDistinct.add(name);
    if (cands.length) {
      const exact = seatNo !== null ? cands.find((c) => c.seatNo === seatNo) : undefined;
      return (exact ?? cands.find((c) => c.status === "enrolled") ?? cands[0]).id;
    }
    const [m] = await db
      .insert(s.members)
      .values({ branchId: this.branchId, name, status: "withdrawn", memberKind: "student", memo: `시트 이관 시 자동 생성 (${note}에만 있는 이름)` })
      .returning({ id: s.members.id });
    const row: IndexRow = { id: m.id, status: "withdrawn", seatNo: null };
    this.byName.set(name, [row]);
    this.byLower.set(name.toLowerCase(), [row]);
    this.created++;
    return m.id;
  }
}

async function main() {
  const [branch] = await db.select().from(s.branches).where(eq(s.branches.code, branchCode));
  if (!branch) throw new Error(`지점 코드 ${branchCode} 가 없습니다`);
  const staff = await db
    .select({ id: s.users.id, name: s.users.name, role: s.memberships.role })
    .from(s.memberships)
    .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
    .where(eq(s.memberships.branchId, branch.id));
  const [hq] = await db.select().from(s.users).where(eq(s.users.isHqAdmin, true)).limit(1);
  // 지점에 지점장·멘토·조교가 아직 없으면 본사 관리자 이름으로 기록한다 (운영 최초 적재)
  const hqStaff = hq ? { id: hq.id, name: hq.name, role: "hq_admin" as const } : undefined;
  const manager = staff.find((u) => u.role === "branch_manager") ?? hqStaff;
  const mentor = staff.find((u) => u.role === "mentor") ?? manager;
  const assistant = staff.find((u) => u.role === "assistant") ?? manager;
  if (!manager || !mentor || !assistant) throw new Error("지점장 계정이나 본사 관리자 계정이 있어야 합니다");
  log(`== 지점 ${branch.name} (${branch.code}) · 기준일 ${today}`);

  // ---------- 1. 지점 업무 데이터 초기화 ----------
  const memberIds = (await db.select({ id: s.members.id }).from(s.members).where(eq(s.members.branchId, branch.id))).map((r) => r.id);
  await db.transaction(async (tx) => {
    // 이슈가 체크를 참조하므로 이슈부터 지운다
    const issueIds = (await tx.select({ id: s.issues.id }).from(s.issues).where(eq(s.issues.branchId, branch.id))).map((r) => r.id);
    if (issueIds.length) await tx.delete(s.issueComments).where(inArray(s.issueComments.issueId, issueIds));
    await tx.delete(s.notifications).where(eq(s.notifications.branchId, branch.id));
    await tx.delete(s.issues).where(eq(s.issues.branchId, branch.id));
    await tx.delete(s.checks).where(eq(s.checks.branchId, branch.id));
    await tx.delete(s.roundingSessions).where(eq(s.roundingSessions.branchId, branch.id));
    const logIds = (await tx.select({ id: s.counselLogs.id }).from(s.counselLogs).where(eq(s.counselLogs.branchId, branch.id))).map((r) => r.id);
    if (logIds.length) await tx.delete(s.counselComments).where(inArray(s.counselComments.logId, logIds));
    await tx.delete(s.counselLogs).where(eq(s.counselLogs.branchId, branch.id));
    await tx.delete(s.mealOrders).where(eq(s.mealOrders.branchId, branch.id));
    await tx.delete(s.mealSettlements).where(eq(s.mealSettlements.branchId, branch.id));
    await tx.delete(s.mockExamRounds).where(eq(s.mockExamRounds.branchId, branch.id));
    await tx.delete(s.memberFiles).where(eq(s.memberFiles.branchId, branch.id));
    await tx.delete(s.heroLinks).where(eq(s.heroLinks.branchId, branch.id));
    await tx.delete(s.alimtalkMessages).where(eq(s.alimtalkMessages.branchId, branch.id));
    await tx.delete(s.eventOutbox).where(eq(s.eventOutbox.branchId, branch.id));
    await tx.delete(s.workLogs).where(eq(s.workLogs.branchId, branch.id));
    if (memberIds.length) await tx.delete(s.members).where(inArray(s.members.id, memberIds));
    await tx.delete(s.seats).where(eq(s.seats.branchId, branch.id));
  });
  log(`  기존 데이터 정리: 회원 ${memberIds.length}명 등`);

  // ---------- 2. 좌석·설정 ----------
  const SEAT_COUNT = Number(opt("seats", "77"));
  await db.insert(s.seats).values(Array.from({ length: SEAT_COUNT }, (_, i) => ({ branchId: branch.id, seatNo: i + 1, zone: "A", sort: i + 1 })));
  const roundsPerDay = Number(opt("rounds", "11"));
  await db
    .update(s.branches)
    .set({ settings: { ...branch.settings, roundsPerDay, roundSchedule: branch.settings.roundSchedule?.slice(0, roundsPerDay) } })
    .where(eq(s.branches.id, branch.id));
  log(`  좌석 ${SEAT_COUNT}석, 하루 회차 ${roundsPerDay}`);

  const ctx = (await buildCtx(manager.id, branch.id))!;
  const index = new MemberIndex(branch.id);

  // ---------- 3. 회원 (고객정보 시트 → CSV 이관 파이프라인) ----------
  if (files.members) {
    const book = readBook(path(files.members));
    const tab = book["고객정보"] ?? book[Object.keys(book)[0]];
    const header = tab[0].map((h, i) => (h === "Column 7" ? "구분" : h || `col${i + 1}`));
    header[0] = header[0] && !/^\d+$/.test(header[0]) ? header[0] : "좌석번호";
    const data = [header, ...tab.slice(1).filter((r) => r[1])];
    const mapping = autoMapHeaders(header);
    const pv = await previewImport(ctx, data, mapping, today);
    const bad = new Set(pv.errors.map((e) => e.row));
    const result = await commitImport(
      ctx,
      pv.rows.filter((r) => !bad.has(r.row)),
    );
    log(`  회원: ${data.length - 1}행 → 신규 ${result.created}, 갱신 ${result.updated}, 오류 제외 ${bad.size}, 실패 ${result.failed.length}, 경고 ${pv.warnings.length}`);
    for (const f of result.failed) log(`    실패 ${f.row}행: ${f.message}`);

    // 모의고사 탭
    const mock = Object.entries(book).find(([n]) => n.startsWith("모의고사"));
    await index.load();
    if (mock) {
      const [tabName, g] = mock;
      const price = num((tabName.match(/(\d[\d,]*)원/) ?? [])[1] ?? "") ?? 0;
      const blocks: { col: number; ym: string; label: string }[] = [];
      g[0].forEach((v, c) => {
        const m = v.match(/(\d{4})년\s*(\d{1,2})월/);
        if (m) blocks.push({ col: c, ym: `${m[1]}-${m[2].padStart(2, "0")}`, label: v.trim() });
      });
      let apps = 0;
      for (const b of blocks) {
        const hdr = g[1].slice(b.col, b.col + 9);
        const ci = (label: string) => {
          const i = hdr.findIndex((h) => h === label);
          return i < 0 ? -1 : b.col + i;
        };
        const cSeat = ci("좌석번호"), cName = ci("성명"), cApplied = ci("신청여부"), cTrack = ci("계열"), cSubj = ci("학교"), cPaid = ci("결제일");
        if (cName < 0) continue;
        const [round] = await db.insert(s.mockExamRounds).values({ branchId: branch.id, yearMonth: b.ym, name: `${b.label} 모의고사`, price }).returning();
        for (let r = 2; r < g.length; r++) {
          const name = cell(g, r, cName);
          if (!name) continue;
          const memberId = await index.resolve(name, num(cell(g, r, cSeat)), "모의고사 탭");
          if (!memberId) continue;
          const applied = cApplied >= 0 ? truthy(cell(g, r, cApplied)) || !!cell(g, r, cPaid) : true;
          const paidAt = cPaid >= 0 && isDate(cell(g, r, cPaid)) ? dateOf(cell(g, r, cPaid)) : null;
          await db
            .insert(s.mockExamApplications)
            .values({ roundId: round.id, memberId, applied, track: cTrack >= 0 ? cell(g, r, cTrack) || null : null, subjects: cSubj >= 0 ? cell(g, r, cSubj) || null : null, paidAt, paidAmount: paidAt ? price : null })
            .onConflictDoNothing();
          apps++;
        }
      }
      log(`  모의고사: 회차 ${blocks.length}, 신청 ${apps}`);
    }
  }
  await index.load();

  // ---------- 4. 집중관리일지 ----------
  if (files.counsel) {
    const book = readBook(path(files.counsel));
    const ym = (files.counsel.match(/(\d{4})\.(\d{2})/) ?? [])[0]?.replace(".", "-") ?? today.slice(0, 7);
    const first = new Date(`${ym}-01T00:00:00`);
    const monday1 = new Date(first);
    monday1.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const mondayOf = (week: number) => {
      const d = new Date(monday1);
      d.setDate(monday1.getDate() + 7 * (week - 1));
      return d.toISOString().slice(0, 10);
    };
    let weekly = 0, daily = 0;
    const wk = book["주간 상담일지"];
    if (wk) {
      const hdr = wk[0];
      for (let r = 1; r < wk.length; r++) {
        const name = cell(wk, r, 1);
        if (!name) continue;
        const memberId = await index.resolve(name, num(cell(wk, r, 0)), "주간 상담일지");
        if (!memberId) continue;
        for (let c = 6; c < hdr.length; c++) {
          const text = cell(wk, r, c);
          if (!text) continue;
          const m = hdr[c].match(/(\d)주차/);
          if (!m) continue;
          const periodDate = mondayOf(Number(m[1]));
          const isIssue = /원장/.test(hdr[c]);
          const vals = isIssue ? { issueText: text, issueBy: manager.id, issueAt: new Date(periodDate) } : { resolutionText: text, resolutionBy: mentor.id, resolutionAt: new Date(periodDate) };
          await db
            .insert(s.counselLogs)
            .values({ branchId: branch.id, memberId, logType: "weekly", periodDate, ...vals })
            .onConflictDoUpdate({ target: [s.counselLogs.memberId, s.counselLogs.logType, s.counselLogs.periodDate], set: vals });
          weekly++;
        }
      }
    }
    for (const [tabName, g] of Object.entries(book)) {
      if (tabName === "주간 상담일지" || /템플릿/.test(tabName)) continue;
      const r1 = g[0] ?? [];
      const nameIdx = r1.findIndex((v) => v === "이름");
      const name = nameIdx >= 0 ? r1[nameIdx + 1] : tabName.replace(/^\d+\s*/, "");
      const seatNo = num(r1[1] ?? "");
      const memberId = await index.resolve(name, seatNo, "집중관리 일별 탭");
      if (!memberId) continue;
      const hdrRow = g.findIndex((row) => row.some((v) => /원장/.test(v)));
      const cIssue = hdrRow >= 0 ? g[hdrRow].findIndex((v) => /원장/.test(v)) : 1;
      const cRes = hdrRow >= 0 ? g[hdrRow].findIndex((v) => /선생님|멘토/.test(v)) : 4;
      for (let r = hdrRow + 1; r < g.length; r++) {
        const d = cell(g, r, 0);
        if (!isDate(d)) continue;
        const issueText = cIssue >= 0 ? cell(g, r, cIssue) : "";
        const resolutionText = cRes >= 0 ? cell(g, r, cRes) : "";
        if (!issueText && !resolutionText) continue;
        await db
          .insert(s.counselLogs)
          .values({
            branchId: branch.id,
            memberId,
            logType: "focus_daily",
            periodDate: dateOf(d),
            issueText: issueText || null,
            issueBy: issueText ? manager.id : null,
            issueAt: issueText ? new Date(dateOf(d)) : null,
            resolutionText: resolutionText || null,
            resolutionBy: resolutionText ? mentor.id : null,
            resolutionAt: resolutionText ? new Date(dateOf(d)) : null,
          })
          .onConflictDoNothing();
        daily++;
      }
      await db.update(s.members).set({ focusCare: true }).where(eq(s.members.id, memberId));
    }
    log(`  상담일지: 주간 ${weekly}칸, 일별 ${daily}건`);
  }

  // ---------- 5. 게시용 시트 → 체크 ----------
  if (files.board) {
    const book = readBook(path(files.board));
    const rules = await db
      .select()
      .from(s.penaltyRules)
      .where(and(eq(s.penaltyRules.active, true), or(eq(s.penaltyRules.branchId, branch.id), isNull(s.penaltyRules.branchId))));
    const ruleByPoints = new Map<number, string>();
    for (const r of [...rules].reverse()) ruleByPoints.set(r.points, r.id);
    const ITEM: Record<string, string> = { 출석: "attendance", 플래너: "planner", 영단어: "vocab", 점검완료: "checkout" };
    const tabs = Object.entries(book).filter(([n]) => /^\d{1,2}월\s*\d주$/.test(n));
    let cells = 0, skipped = 0;
    const sessions = new Set<string>();
    const memberCache = new Map<string, string | null>();
    for (const [tabName, g] of tabs) {
      const firstDay = g.findIndex((row) => row[1] === "출석");
      if (firstDay < 2) continue;
      const seatRow = g[firstDay - 2], nameRow = g[firstDay - 1];
      const cols: { c: number; memberId: string; seatNo: number | null }[] = [];
      for (let c = 2; c < nameRow.length; c++) {
        const name = (nameRow[c] ?? "").trim();
        if (!name) continue;
        const seatNo = num(seatRow[c] ?? "");
        const key = `${name}|${seatNo}`;
        if (!memberCache.has(key)) memberCache.set(key, await index.resolve(name, seatNo, "게시용 시트"));
        const memberId = memberCache.get(key);
        if (memberId) cols.push({ c, memberId, seatNo });
      }
      let date = "";
      const batch: (typeof s.checks.$inferInsert)[] = [];
      for (let r = firstDay; r < g.length; r++) {
        if (isDate(cell(g, r, 0))) date = dateOf(cell(g, r, 0));
        const label = cell(g, r, 1);
        if (!date || !label) continue;
        let itemKey: string, roundNo = 0;
        const rm = label.match(/^R(\d+)$/i);
        if (rm) {
          itemKey = "round";
          roundNo = Number(rm[1]);
        } else if (ITEM[label]) itemKey = ITEM[label];
        else continue;
        for (const col of cols) {
          const v = cell(g, r, col.c);
          if (!v) continue;
          let grade: s.Grade, points = 0;
          const n = num(v);
          if (n !== null) {
            grade = "p";
            points = n;
          } else if (/^a/i.test(v)) grade = "a";
          else if (/^b/i.test(v)) grade = "b";
          else {
            skipped++;
            continue;
          }
          batch.push({
            branchId: branch.id,
            memberId: col.memberId,
            seatNoSnapshot: col.seatNo,
            date,
            itemKey,
            roundNo,
            grade,
            points,
            penaltyRuleId: grade === "p" ? (ruleByPoints.get(points) ?? null) : null,
            note: v.length > 1 && grade !== "p" ? `시트 값 ${v}` : null,
            createdBy: assistant.id,
          });
          if (itemKey === "round") sessions.add(`${date}|${roundNo}`);
        }
      }
      for (let i = 0; i < batch.length; i += 1000) {
        await db.insert(s.checks).values(batch.slice(i, i + 1000)).onConflictDoNothing();
      }
      if (!batch.length) log(`    탭 '${tabName}': 읽은 체크 없음 (날짜 행 ${g.filter((row) => isDate(row[0] ?? "")).length}개, 이름 열 ${cols.length}개)`);
      cells += batch.length;
    }
    const sessionRows = [...sessions].map((k) => {
      const [date, roundNo] = k.split("|");
      return { branchId: branch.id, date, roundNo: Number(roundNo), startedBy: assistant.id, startedAt: new Date(`${date}T09:00:00+09:00`), completedAt: new Date(`${date}T23:00:00+09:00`) };
    });
    for (let i = 0; i < sessionRows.length; i += 1000) await db.insert(s.roundingSessions).values(sessionRows.slice(i, i + 1000)).onConflictDoNothing();
    const sess = await db.select({ id: s.roundingSessions.id, date: s.roundingSessions.date, roundNo: s.roundingSessions.roundNo }).from(s.roundingSessions).where(eq(s.roundingSessions.branchId, branch.id));
    for (const x of sess) {
      await db.update(s.checks).set({ sessionId: x.id }).where(and(eq(s.checks.branchId, branch.id), eq(s.checks.date, x.date), eq(s.checks.itemKey, "round"), eq(s.checks.roundNo, x.roundNo)));
    }
    log(`  라운딩: 주차 탭 ${tabs.length}, 체크 ${cells}건, 회차 ${sessionRows.length}, 해석 불가 건너뜀 ${skipped}`);
  }

  // ---------- 6. 식사주문 ----------
  if (files.meals) {
    const book = readBook(path(files.meals));
    const [setting] = await db.select().from(s.mealSettings).where(eq(s.mealSettings.branchId, branch.id));
    const lunchPrice = setting?.lunchPrice ?? 8000, dinnerPrice = setting?.dinnerPrice ?? 8000;
    if (!setting) await db.insert(s.mealSettings).values({ branchId: branch.id });
    let orders = 0, settlements = 0;
    for (const [tabName, g] of Object.entries(book)) {
      if (!/^\d{1,2}월$/.test(tabName)) continue;
      const hdrRow = g.findIndex((row) => row[0] === "좌석번호");
      // 날짜 행은 보통 A열이 '날짜'지만, 그 칸이 비어 있는 탭이 있다(동탄2 2월). 라벨이 없으면 헤더 바로 위에서 날짜가 늘어선 행을 찾는다.
      let dateRow = g.findIndex((row) => row[0] === "날짜");
      if (dateRow < 0 && hdrRow > 0) {
        for (let r = hdrRow - 1; r >= 0 && r >= hdrRow - 3; r--) {
          if (g[r].filter(isDate).length >= 5) {
            dateRow = r;
            break;
          }
        }
      }
      if (dateRow < 0 || hdrRow < 0) {
        // 조용히 건너뛰면 그 달이 통째로 사라진다. 반드시 남긴다.
        log(`    건너뜀: '${tabName}' 탭에서 ${hdrRow < 0 ? "좌석번호 행" : "날짜 행"}을 찾지 못했습니다`);
        continue;
      }
      const dateCols: { c: number; date: string; meal: s.MealKind }[] = [];
      let current = "";
      for (let c = 2; c < g[hdrRow].length; c++) {
        if (isDate(cell(g, dateRow, c))) current = dateOf(cell(g, dateRow, c));
        const ld = cell(g, hdrRow, c);
        if (current && (ld === "L" || ld === "D")) dateCols.push({ c, date: current, meal: ld === "L" ? "lunch" : "dinner" });
      }
      const cSum = g[hdrRow].indexOf("합계"), cAmt = g[hdrRow].indexOf("식사비용"), cPaid = g[hdrRow].indexOf("결제일"), cPaidAmt = g[hdrRow].indexOf("결제액");
      // 1월 탭 앞에 전월 말 날짜가 붙는 경우가 있어 가장 많은 달을 그 탭의 월로 본다
      const monthCount = new Map<string, number>();
      for (const dc of dateCols) monthCount.set(dc.date.slice(0, 7), (monthCount.get(dc.date.slice(0, 7)) ?? 0) + 1);
      const ym = [...monthCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const batch: (typeof s.mealOrders.$inferInsert)[] = [];
      for (let r = hdrRow + 1; r < g.length; r++) {
        const seatRaw = cell(g, r, 0), name = cell(g, r, 1);
        if (seatRaw === "합계") break;
        if (!name) continue;
        const memberId = await index.resolve(name, num(seatRaw), "식사주문 시트");
        if (!memberId) continue;
        for (const dc of dateCols) {
          if (!truthy(cell(g, r, dc.c))) continue;
          batch.push({ branchId: branch.id, memberId, date: dc.date, meal: dc.meal, ordered: true, priceSnapshot: dc.meal === "lunch" ? lunchPrice : dinnerPrice, changedBy: manager.id, changedAt: new Date(`${dc.date}T12:00:00+09:00`) });
        }
        const count = cSum >= 0 ? num(cell(g, r, cSum)) : null;
        const amount = cAmt >= 0 ? num(cell(g, r, cAmt)) : null;
        const paidAt = cPaid >= 0 && isDate(cell(g, r, cPaid)) ? dateOf(cell(g, r, cPaid)) : null;
        const paidAmount = cPaidAmt >= 0 ? num(cell(g, r, cPaidAmt)) : null;
        if (ym && (count || paidAt)) {
          await db
            .insert(s.mealSettlements)
            .values({ branchId: branch.id, memberId, yearMonth: ym, mealCount: count ?? 0, amount: amount ?? 0, paidAt, paidAmount: paidAt ? (paidAmount ?? amount ?? null) : paidAmount })
            .onConflictDoNothing();
          settlements++;
        }
      }
      for (let i = 0; i < batch.length; i += 1000) await db.insert(s.mealOrders).values(batch.slice(i, i + 1000)).onConflictDoNothing();
      orders += batch.length;
    }
    log(`  식사주문: 주문 ${orders}건, 월 정산 ${settlements}건`);
  }

  // ---------- 7. 근무일지 ----------
  if (files.worklog) {
    const book = readBook(path(files.worklog));
    const FORMS = new Set(["주간조교", "야간조교", "원장", "컨설팅", "선생님"]);
    const roleOf = (form: string): s.BranchRole => (form === "원장" ? "branch_manager" : form === "컨설팅" || form === "선생님" ? "mentor" : "assistant");
    const slots = await db.select().from(s.shiftSlots).where(and(eq(s.shiftSlots.branchId, branch.id), eq(s.shiftSlots.active, true)));
    const slotByLabel = new Map(slots.map((x) => [x.label, x.key]));
    const userByName = new Map<string, string>();
    for (const u of staff) userByName.set(u.name.replace(/\s+/g, ""), u.id);
    let createdUsers = 0, logs = 0, seq = 0;
    const ensureUser = async (name: string, form: string, workDays: string) => {
      const key = name.replace(/\s+/g, "");
      if (userByName.has(key)) return userByName.get(key)!;
      seq++;
      const loginId = `${branch.code.toLowerCase()}_staff${String(seq).padStart(2, "0")}_${randomBytes(2).toString("hex")}`;
      const [u] = await db.insert(s.users).values({ loginId, name, passwordHash: await hashPassword(randomBytes(12).toString("base64url")) }).returning();
      await db.insert(s.memberships).values({ userId: u.id, branchId: branch.id, role: roleOf(form) });
      await db.insert(s.staffProfiles).values({ userId: u.id, branchId: branch.id, employmentType: form, workDays: workDays || null }).onConflictDoNothing();
      userByName.set(key, u.id);
      createdUsers++;
      return u.id;
    };
    for (const [tabName, g] of Object.entries(book)) {
      if (!/^\d{1,2}\.\d{1,2}$/.test(tabName)) continue;
      const date = isDate(cell(g, 0, 0)) ? dateOf(cell(g, 0, 0)) : null;
      const hdrRow = g.findIndex((row) => row[0] === "근무자");
      if (!date || hdrRow < 0) continue;
      const hdr = g[hdrRow];
      const cHours = hdr.indexOf("근무시간"), cOver = hdr.indexOf("초과근무"), cReason = hdr.indexOf("사유"), cConfirm = hdr.indexOf("본사확인");
      const slotCols = hdr.map((h, c) => ({ c, key: slotByLabel.get(h) })).filter((x) => x.key) as { c: number; key: string }[];
      for (let r = hdrRow + 1; r < g.length; r++) {
        const name = cell(g, r, 0), form = cell(g, r, 1);
        if (!name || !FORMS.has(form)) continue;
        const slotKeys = slotCols.filter((x) => truthy(cell(g, r, x.c))).map((x) => x.key);
        const hours = num(cell(g, r, cHours)) ?? 0;
        const overtime = cOver >= 0 ? (num(cell(g, r, cOver)) ?? 0) : 0;
        if (!slotKeys.length && hours === 0 && overtime === 0) continue;
        const userId = await ensureUser(name, form, cell(g, r, 3));
        const confirmed = cConfirm >= 0 && truthy(cell(g, r, cConfirm));
        await db
          .insert(s.workLogs)
          .values({
            branchId: branch.id,
            userId,
            date,
            slotKeys,
            hoursX100: Math.round(hours * 100),
            overtimeX100: Math.round(overtime * 100),
            overtimeReason: cReason >= 0 ? cell(g, r, cReason) || null : null,
            hqConfirmedBy: confirmed && hq ? hq.id : null,
            hqConfirmedAt: confirmed ? new Date(`${date}T23:00:00+09:00`) : null,
          })
          .onConflictDoNothing();
        logs++;
      }
    }
    log(`  근무일지: 기록 ${logs}건, 새 직원 계정 ${createdUsers}명 (비밀번호는 설정 › 사용자에서 재설정)`);
  }

  // ---------- 요약 ----------
  const [agg] = await db.execute<Record<string, string>>(sql`
    select (select count(*) from members where branch_id = ${branch.id}) members,
      (select count(*) from members where branch_id = ${branch.id} and status = 'enrolled') enrolled,
      (select count(*) from checks where branch_id = ${branch.id}) checks,
      (select count(*) from counsel_logs where branch_id = ${branch.id}) counsel,
      (select count(*) from meal_orders where branch_id = ${branch.id}) meals,
      (select count(*) from work_logs where branch_id = ${branch.id}) worklogs,
      (select count(*) from mock_exam_rounds where branch_id = ${branch.id}) mock_rounds`);
  if (index.newDistinct.size) {
    log(`  확인 필요: 고객정보 시트에 없는 동명이인 표기 ${index.newDistinct.size}건 → ${[...index.newDistinct].join(", ")}`);
    log(`    (다른 시트에만 있는 이름이라 별도 회원으로 만들었습니다. 실제로 같은 사람이면 회원 화면에서 합쳐 주세요)`);
  }
  log(`== 완료: 회원 ${agg.members}(등록 ${agg.enrolled}, 자리표시 생성 ${index.created}) · 체크 ${agg.checks} · 상담 ${agg.counsel} · 식사 ${agg.meals} · 근무 ${agg.worklogs} · 모의고사 회차 ${agg.mock_rounds}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
