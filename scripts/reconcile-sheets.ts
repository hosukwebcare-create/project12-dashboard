/**
 * 시트 ↔ DB 대사. "옮겨졌다"가 아니라 "같다"를 숫자로 증명한다.
 *
 *   DATABASE_URL=... pnpm exec tsx scripts/reconcile-sheets.ts --branch DT2 --dir ~/Downloads \
 *     --members "고객정보시트_프로젝트12_동탄2.xlsx" --board "게시용 회원생활관리 시트_프로젝트12_동탄2.xlsx" \
 *     --meals "식사 주문시트_프로젝트12(2026)_동탄2.xlsx" --worklog "조교근무일지(2026)_ 동탄2.xlsx" \
 *     --counsel "(동탄) 집중관리일지 -2026.07.xlsx" --out ./대사결과
 *
 * 적재 스크립트(migrate-sheets.ts)의 파서를 쓰지 않고 시트 셀을 직접 읽어 비교한다.
 * 같은 파서로 양쪽을 만들면 파서의 실수는 영원히 안 보이기 때문이다.
 *
 * 대조 범위: 회원 · 라운딩 체크 · 식사 주문 · 근무 기록(타임 체크 포함) · 상담일지 · 모의고사.
 * 처음에는 근무·상담이 건수만 찍고 통과 처리돼 있었다. 그래서 근무 타임 2,512칸이 통째로
 * 빠진 것을 대사가 못 잡았다. 건수만 세는 절은 다시 만들지 않는다.
 *
 * 콘솔에는 집계만 찍고, 실명·연락처가 들어가는 상세 목록은 --out 폴더의 HTML 로만 쓴다.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db/client";
import * as s from "@/db/schema";

// ---------- 인자 ----------
const argv = process.argv.slice(2);
const opt = (k: string, d = ""): string => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const branchCode = opt("branch", "DT2");
const dir = opt("dir", ".").replace(/^~/, process.env.HOME ?? "");
const outDir = opt("out", "./대사결과").replace(/^~/, process.env.HOME ?? "");
const files = { members: opt("members"), board: opt("board"), meals: opt("meals"), worklog: opt("worklog"), counsel: opt("counsel") };
const path = (f: string) => (f ? (f.startsWith("/") ? f : join(dir, f)) : "");

// ---------- xlsx ----------
type Grid = string[][];
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
  for (const name of wb.SheetNames) out[name] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" }).map((r) => r.map(fmt));
  return out;
}

// ---------- 정규화 (적재 파서와 독립적으로 다시 구현한다) ----------
/** 이름 뒤 /S(단기) · /3 · /n 같은 표기를 떼어 낸다 */
function splitName(raw: string): { name: string; short: boolean; tag: string | null } {
  const t = raw.replace(/\s+/g, "");
  const m = t.match(/^(.*?)[/,]+\s*([A-Za-z0-9가-힣]*)$/);
  if (!m) return { name: t, short: false, tag: null };
  const suffix = m[2];
  if (/^[Ss]$/.test(suffix)) return { name: m[1], short: true, tag: null };
  return { name: m[1], short: false, tag: suffix || null };
}
const digits = (v: string) => v.replace(/\D/g, "");
function normPhone(raw: string): string | null {
  const d = digits(raw);
  if (!d) return null;
  if (d.length === 11 && d.startsWith("010")) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return null; // 형식이 아니면 적재 시 메모로 옮겨진다
}
function normDate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
function splitSchoolGrade(raw: string): { school: string | null; grade: string | null } {
  const t = raw.trim();
  if (!t) return { school: null, grade: null };
  const m = t.match(/^(.*?)\s*(\d)\s*$/);
  if (m && m[1]) return { school: m[1].trim(), grade: m[2] };
  return { school: t, grade: null };
}
const TRACKS = ["문과", "이과", "예체능"];
const truthy = (v: string) => /^(o|O|ㅇ|y|Y|예|yes|true|1|✓)$/.test(v.trim());
const STATUS_TOKEN: Record<string, string> = { 상담: "prospect", 종료: "withdrawn", 퇴원: "withdrawn", 휴원: "prospect" };

type Diff = { row: number; name: string; field: string; sheet: string; db: string; kind: "값 다름" | "누락" | "의도된 변환" };

async function main() {
  const [branch] = await db.select().from(s.branches).where(eq(s.branches.code, branchCode));
  if (!branch) throw new Error(`지점 ${branchCode} 이(가) 없습니다`);
  mkdirSync(outDir, { recursive: true });
  const log = (m: string) => console.log(m);
  log(`== 시트 ↔ DB 대사 · ${branch.name}(${branch.code})`);

  const diffs: Diff[] = [];
  const summary: { area: string; sheet: number; db: number; ok: boolean; note: string }[] = [];
  // 집중관리일지 파일의 개인 일별 탭 이름 = 그 시점의 집중관리 대상. 고객정보 시트의 집중관리 칸보다 최신인 경우가 있다.
  const focusTabs = new Set<string>();
  if (files.counsel) {
    for (const tab of Object.keys(readBook(path(files.counsel)))) {
      const t = tab.replace(/^\d+\s*/, "").replace(/\s+/g, "");
      if (/^[가-힣]{2,4}[A-Za-z]?$/.test(t)) focusTabs.add(t);
    }
  }

  // ---------- 1. 회원 ----------
  const sheetOnly: { row: number; name: string; seatNo: string }[] = [];
  let dbOnly: { name: string; seatNo: number | null; status: string }[] = [];
  if (files.members) {
    const book = readBook(path(files.members));
    const tab = book["고객정보"] ?? book[Object.keys(book)[0]];
    const header = tab[0].map((h, i) => (h === "Column 7" ? "구분" : h || `col${i + 1}`));
    header[0] = header[0] && !/^\d+$/.test(header[0]) ? header[0] : "좌석번호";
    const col = (label: string) => header.findIndex((h) => h.trim() === label);
    const C = {
      seat: col("좌석번호"), name: col("성명"), phone: col("연락처"), birth: col("생년월일"), gender: col("성별"),
      kind: col("구분"), type: col("TYPE"), focus: col("집중관리"), target: col("목표대학/학과/시험"),
      schoolGrade: col("학교명/학년"), track: col("계열"), address: col("주소"),
      gName: col("보호자 성함"), gPhone: col("보호자 연락처"), memo: col("비고"), first: col("첫 등원일"),
    };
    const rows = tab.slice(1).map((cells, i) => ({ rowNo: i + 2, cells })).filter((r) => r.cells[C.name]?.trim());

    // DB
    const dbRows = await db
      .select({ id: s.members.id, name: s.members.name, seatNo: s.seats.seatNo, phone: s.members.phone, birthDate: s.members.birthDate, gender: s.members.gender, memberKind: s.members.memberKind, studentType: s.members.studentType, focusCare: s.members.focusCare, target: s.members.target, school: s.members.school, grade: s.members.grade, track: s.members.track, address: s.members.address, memo: s.members.memo, status: s.members.status, firstRegisteredAt: s.members.firstRegisteredAt })
      .from(s.members)
      .leftJoin(s.seats, eq(s.seats.id, s.members.seatId))
      .where(eq(s.members.branchId, branch.id));
    const guardians = await db.select().from(s.memberGuardians);
    const gByMember = new Map<string, (typeof guardians)[number]>();
    for (const g of guardians) if (!gByMember.has(g.memberId)) gByMember.set(g.memberId, g);
    // 등록기간·단기 여부는 member_enrollments 에 있다
    const enrollments = await db.select().from(s.memberEnrollments);
    const eByMember = new Map<string, (typeof enrollments)[number]>();
    for (const e of enrollments) if (!eByMember.has(e.memberId)) eByMember.set(e.memberId, e);

    const bySeat = new Map<number, typeof dbRows>();
    const byName = new Map<string, typeof dbRows>();
    for (const d of dbRows) {
      if (d.seatNo !== null) bySeat.set(d.seatNo, [...(bySeat.get(d.seatNo) ?? []), d]);
      byName.set(d.name.replace(/\s+/g, ""), [...(byName.get(d.name.replace(/\s+/g, "")) ?? []), d]);
    }
    const matched = new Set<string>();

    for (const { rowNo, cells } of rows) {
      const g = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
      const { name, short, tag } = splitName(g(C.name));
      const seatRaw = g(C.seat);
      const seatNum = /^\d+$/.test(seatRaw) ? Number(seatRaw) : null;
      const statusToken = seatNum === null && seatRaw ? STATUS_TOKEN[seatRaw] ?? null : null;

      // 매칭: 좌석+이름 → 이름
      const cand = (seatNum !== null ? bySeat.get(seatNum) ?? [] : []).filter((d) => d.name.replace(/\s+/g, "") === name);
      const hit = cand[0] ?? (byName.get(name) ?? []).find((d) => !matched.has(d.id));
      if (!hit) {
        sheetOnly.push({ row: rowNo, name, seatNo: seatRaw });
        continue;
      }
      matched.add(hit.id);
      const gd = gByMember.get(hit.id);
      const cmp = (field: string, sheetVal: string | null, dbVal: string | null, kind: Diff["kind"] = "값 다름") => {
        const a = (sheetVal ?? "").trim();
        const b = (dbVal ?? "").trim();
        if (a === b) return;
        diffs.push({ row: rowNo, name, field, sheet: a || "(빈칸)", db: b || "(빈칸)", kind });
      };

      // 좌석·상태
      const expectSeat = statusToken ? null : seatNum;
      cmp("좌석번호", expectSeat === null ? "" : String(expectSeat), hit.seatNo === null ? "" : String(hit.seatNo));
      if (statusToken) cmp("상태", statusToken, hit.status, "의도된 변환");
      // 값
      const phone = normPhone(g(C.phone));
      cmp("연락처", phone ?? "", hit.phone ?? "", phone === null && g(C.phone) ? "의도된 변환" : "값 다름");
      cmp("생년월일", normDate(g(C.birth)) ?? "", hit.birthDate ?? "");
      cmp("성별", g(C.gender), hit.gender ?? "");
      cmp("구분", /성인|adult/i.test(g(C.kind)) ? "adult" : "student", hit.memberKind);
      cmp("TYPE", g(C.type), hit.studentType ?? "");
      // 고객정보 시트는 비었는데 집중관리일지에 개인 탭이 있으면 일지 쪽이 최신이다
      const focusBySheet = truthy(g(C.focus));
      cmp("집중관리", focusBySheet ? "O" : "", hit.focusCare ? "O" : "", !focusBySheet && hit.focusCare && focusTabs.has(name) ? "의도된 변환" : "값 다름");
      cmp("목표", g(C.target), hit.target ?? "");
      const sg = splitSchoolGrade(g(C.schoolGrade));
      cmp("학교", sg.school ?? "", hit.school ?? "");
      cmp("학년", sg.grade ?? "", hit.grade ?? "");
      const trackRaw = g(C.track);
      cmp("계열", TRACKS.includes(trackRaw) ? trackRaw : "", hit.track ?? "", trackRaw && !TRACKS.includes(trackRaw) ? "의도된 변환" : "값 다름");
      cmp("보호자 이름", g(C.gName), gd?.name ?? "");
      cmp("보호자 연락처", normPhone(g(C.gPhone)) ?? "", gd?.phone ?? "");
      cmp("첫 등원일", normDate(g(C.first)) ?? "", hit.firstRegisteredAt ?? "");
      if (short) cmp("등록 유형", "short", eByMember.get(hit.id)?.planType ?? "(등록기간 없음)", "의도된 변환");
      if (tag) cmp("이름 표기", `/${tag}`, hit.memo?.includes(tag) ? `메모에 보존` : "(메모에 없음)", "의도된 변환");
    }
    dbOnly = dbRows.filter((d) => !matched.has(d.id)).map((d) => ({ name: d.name, seatNo: d.seatNo, status: d.status }));

    const hard = diffs.filter((d) => d.kind !== "의도된 변환").length;
    summary.push({ area: "회원", sheet: rows.length, db: dbRows.length, ok: sheetOnly.length === 0 && hard === 0, note: `시트에만 ${sheetOnly.length}명 · DB에만 ${dbOnly.length}명(다른 시트에서 생성) · 값 불일치 ${hard}건 · 의도된 변환 ${diffs.length - hard}건` });
    log(`  회원: 시트 ${rows.length}행 · DB ${dbRows.length}명 · 시트에만 ${sheetOnly.length} · 값 불일치 ${hard}`);
  }

  // ---------- 2. 라운딩 체크 ----------
  // 게시용 시트는 주차 탭마다 (좌석·이름) 열 × (날짜 × 회차/항목) 행 격자다.
  // (이름·날짜·항목·회차) 를 키로 등급·점수까지 맞춰 본다. 같은 키가 두 탭에 겹치면 DB 는 먼저 들어온 것을 남긴다.
  if (files.board) {
    const book = readBook(path(files.board));
    const ITEM: Record<string, string> = { 출석: "attendance", 플래너: "planner", 영단어: "vocab", 점검완료: "checkout" };
    const sheetMap = new Map<string, { grade: string; points: number }>();
    let dup = 0;
    let unreadable = 0;
    for (const [tabName, g] of Object.entries(book)) {
      if (!/^\d{1,2}월\s*\d주$/.test(tabName)) continue;
      const firstDay = g.findIndex((row) => row[1] === "출석");
      if (firstDay < 2) continue;
      const nameRow = g[firstDay - 1];
      const cols: { c: number; name: string }[] = [];
      for (let c = 2; c < nameRow.length; c++) {
        const raw = (nameRow[c] ?? "").replace(/\s+/g, "").replace(/\/.*$/, "");
        if (!raw || /^(합계|체험|오류)$/.test(raw)) continue;
        // 시트의 동명이인 표기: 'A' 는 접미사 없는 첫 번째 사람, 'B' 이상은 다른 사람
        cols.push({ c, name: /[Aa]$/.test(raw) && raw.length > 2 ? raw.slice(0, -1) : raw });
      }
      let date = "";
      for (let r = firstDay; r < g.length; r++) {
        if (/^\d{4}-\d{2}-\d{2}/.test(g[r][0] ?? "")) date = (g[r][0] ?? "").slice(0, 10);
        const label = (g[r][1] ?? "").trim();
        if (!date || !label) continue;
        const rm = label.match(/^R(\d+)$/i);
        const itemKey = rm ? "round" : ITEM[label];
        if (!itemKey) continue;
        const roundNo = rm ? Number(rm[1]) : 0;
        for (const col of cols) {
          const v = (g[r][col.c] ?? "").trim();
          if (!v) continue;
          let grade: string;
          let points = 0;
          const n = /^\d+(\.\d+)?$/.test(v) ? Number(v) : null;
          if (n !== null) { grade = "p"; points = Math.round(n); }
          else if (/^a/i.test(v)) grade = "a";
          else if (/^b/i.test(v)) grade = "b";
          else { unreadable++; continue; }
          const key = `${col.name}|${date}|${itemKey}|${roundNo}`;
          if (sheetMap.has(key)) dup++;
          else sheetMap.set(key, { grade, points });
        }
      }
    }
    const dbRows = await db.execute<{ k: string; grade: string; points: number }>(
      `select replace(m.name,' ','')||'|'||c.date||'|'||c.item_key||'|'||c.round_no as k, c.grade, c.points from checks c join members m on m.id = c.member_id where c.branch_id = '${branch.id}'` as never,
    );
    const dbMap = new Map(dbRows.map((r) => [r.k, { grade: r.grade, points: Number(r.points) }]));
    const missing: string[] = [];
    const valueDiff: string[] = [];
    for (const [k, v] of sheetMap) {
      const d = dbMap.get(k);
      if (!d) missing.push(k);
      else if (d.grade !== v.grade || (v.grade === "p" && d.points !== v.points)) valueDiff.push(`${k} 시트 ${v.grade}${v.points || ""} / DB ${d.grade}${d.points || ""}`);
    }
    const extra = [...dbMap.keys()].filter((k) => !sheetMap.has(k));
    for (const k of [...missing.slice(0, 100), ...valueDiff.slice(0, 100)]) {
      const [nm, date, item, round] = k.split("|");
      diffs.push({ row: 0, name: nm, field: "라운딩 체크", sheet: `${date} ${item}${round !== "0" ? ` R${round}` : ""}`, db: k.includes("시트") ? k : "(없음)", kind: "누락" });
    }
    summary.push({
      area: "라운딩 체크",
      sheet: sheetMap.size,
      db: dbMap.size,
      ok: missing.length === 0 && valueDiff.length === 0 && extra.length === 0,
      note: `시트 고유 ${sheetMap.size} · DB ${dbMap.size} · 시트에만 ${missing.length} · DB에만 ${extra.length} · 등급/점수 다름 ${valueDiff.length}` + (dup ? ` · 주차 겹침 중복 ${dup}건 제외` : "") + (unreadable ? ` · 해석 불가 셀 ${unreadable}건` : ""),
    });
    log(`  라운딩: 시트 고유 ${sheetMap.size} · DB ${dbMap.size} · 시트에만 ${missing.length} · DB에만 ${extra.length} · 값 다름 ${valueDiff.length}`);
  }

  // ---------- 3. 식사 ----------
  // L/D 는 머리글이고 실제 주문은 그 아래 true 셀이다. (날짜·끼니·이름) 집합으로 비교한다.
  // 월 경계일(6/30)은 두 탭에 겹쳐 적히므로 시트 쪽을 먼저 중복 제거해야 DB 와 맞는다.
  if (files.meals) {
    const book = readBook(path(files.meals));
    const sheetSet = new Set<string>();
    let dupCells = 0;
    let skippedRows = 0;
    for (const [tabName, g] of Object.entries(book)) {
      if (!/^\d{1,2}월$/.test(tabName)) continue;
      const hdrRow = g.findIndex((row) => row[0] === "좌석번호");
      if (hdrRow < 0) continue;
      let dateRow = g.findIndex((row) => row[0] === "날짜");
      if (dateRow < 0) for (let r = hdrRow - 1; r >= 0 && r >= hdrRow - 3; r--) if (g[r].filter((c) => /^\d{4}-\d{2}-\d{2}/.test(c)).length >= 5) { dateRow = r; break; }
      if (dateRow < 0) continue;
      let cur = "";
      const cols: { c: number; date: string; meal: string }[] = [];
      for (let c = 2; c < g[hdrRow].length; c++) {
        if (/^\d{4}-\d{2}-\d{2}/.test(g[dateRow][c] ?? "")) cur = g[dateRow][c].slice(0, 10);
        const ld = g[hdrRow][c];
        if (cur && (ld === "L" || ld === "D")) cols.push({ c, date: cur, meal: ld === "L" ? "lunch" : "dinner" });
      }
      for (let r = hdrRow + 1; r < g.length; r++) {
        if (g[r][0] === "합계") break;
        const nm = (g[r][1] ?? "").replace(/\s+/g, "");
        if (!nm) continue;
        if (/^(합계|체험|오류)$/.test(nm)) {
          if (cols.some((col) => /^(true|o|y|1|예|○|◯|v)$/i.test((g[r][col.c] ?? "").trim()))) skippedRows++;
          continue;
        }
        for (const col of cols) {
          if (!/^(true|o|y|1|예|○|◯|v)$/i.test((g[r][col.c] ?? "").trim())) continue;
          const key = `${col.date}|${col.meal}|${nm}`;
          if (sheetSet.has(key)) dupCells++;
          else sheetSet.add(key);
        }
      }
    }
    const dbRows = await db.execute<{ k: string }>(`select to_char(o.date,'YYYY-MM-DD')||'|'||o.meal||'|'||replace(m.name,' ','') as k from meal_orders o join members m on m.id = o.member_id where o.branch_id = '${branch.id}'` as never);
    const dbSet = new Set(dbRows.map((r) => r.k));
    const missing = [...sheetSet].filter((k) => !dbSet.has(k));
    const extra = [...dbSet].filter((k) => !sheetSet.has(k));
    for (const k of missing.slice(0, 200)) {
      const [date, meal, nm] = k.split("|");
      diffs.push({ row: 0, name: nm, field: "식사 주문", sheet: `${date} ${meal === "lunch" ? "중식" : "석식"}`, db: "(없음)", kind: "누락" });
    }
    summary.push({
      area: "식사 주문",
      sheet: sheetSet.size,
      db: dbSet.size,
      ok: missing.length === 0 && extra.length === 0,
      note: `시트 고유 ${sheetSet.size}건 · DB ${dbSet.size}건 · 시트에만 ${missing.length} · DB에만 ${extra.length}` + (dupCells ? ` · 월 경계일 중복 ${dupCells}건 제외` : "") + (skippedRows ? ` · 합계/체험/오류 행 ${skippedRows}건 제외` : ""),
    });
    log(`  식사: 시트 고유 ${sheetSet.size} · DB ${dbSet.size} · 시트에만 ${missing.length} · DB에만 ${extra.length}`);
  }

  // ---------- 4. 근무 ----------
  // (이름·날짜) 키로 근무시간·초과근무·타임 체크 수까지 맞춰 본다.
  // 타임 체크는 근무 타임이 DB 에 없으면 통째로 버려지던 자리라 반드시 센다.
  if (files.worklog) {
    const book = readBook(path(files.worklog));
    const FORMS = new Set(["주간조교", "야간조교", "원장", "컨설팅", "선생님"]);
    type W = { hours: number; overtime: number; slots: number; reason: string };
    const sheetMap = new Map<string, W>();
    let tabs = 0;
    for (const [tabName, g] of Object.entries(book)) {
      if (!/^\d{1,2}\.\d{1,2}$/.test(tabName)) continue;
      const date = normDate(g[0]?.[0] ?? "") ?? ((g[0]?.[0] ?? "").match(/^\d{4}-\d{2}-\d{2}/) ? (g[0][0] as string).slice(0, 10) : null);
      const hdr = g.findIndex((row) => row[0] === "근무자");
      if (!date || hdr < 0) continue;
      tabs++;
      const H = g[hdr];
      const cH = H.indexOf("근무시간"), cO = H.indexOf("초과근무"), cR = H.indexOf("사유");
      const slotCols = H.map((h, i) => (/^(일\s*)?\d+\s*타임$/.test((h ?? "").trim()) ? i : -1)).filter((i) => i >= 0);
      for (let r = hdr + 1; r < g.length; r++) {
        const name = (g[r][0] ?? "").trim(), form = (g[r][1] ?? "").trim();
        if (!name || !FORMS.has(form)) continue;
        const numOf = (v: string) => { const n = Number((v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
        const slots = slotCols.filter((c) => (g[r][c] ?? "").toLowerCase() === "true").length;
        const hours = cH >= 0 ? numOf(g[r][cH]) : 0;
        const overtime = cO >= 0 ? numOf(g[r][cO]) : 0;
        if (!slots && !hours && !overtime) continue;   // 적재 스크립트와 같은 기준으로 건너뛴다
        sheetMap.set(`${name.replace(/\s+/g, "")}|${date}`, { hours, overtime, slots, reason: cR >= 0 ? (g[r][cR] ?? "").trim() : "" });
      }
    }
    const dbRows = await db.execute<{ k: string; hours: string; overtime: string; slots: string }>(
      `select replace(u.name,' ','')||'|'||w.date as k, (w.hours_x100/100.0)::text as hours, (w.overtime_x100/100.0)::text as overtime,
              coalesce(jsonb_array_length(w.slot_keys), 0)::text as slots
       from work_logs w join users u on u.id = w.user_id where w.branch_id = '${branch.id}'` as never,
    );
    const dbMap = new Map(dbRows.map((r) => [r.k, { hours: Number(r.hours), overtime: Number(r.overtime), slots: Number(r.slots) }]));
    const missing: string[] = [], valueDiff: string[] = [], slotDiff: string[] = [];
    let sheetSlots = 0, dbSlots = 0;
    for (const [k, v] of sheetMap) {
      sheetSlots += v.slots;
      const d = dbMap.get(k);
      if (!d) { missing.push(k); continue; }
      dbSlots += d.slots;
      if (Math.abs(d.hours - v.hours) > 0.005 || Math.abs(d.overtime - v.overtime) > 0.005) valueDiff.push(`${k} 시트 ${v.hours}h(+${v.overtime}) / DB ${d.hours}h(+${d.overtime})`);
      if (d.slots !== v.slots) slotDiff.push(`${k} 시트 타임 ${v.slots}칸 / DB ${d.slots}칸`);
    }
    const extra = [...dbMap.keys()].filter((k) => !sheetMap.has(k));
    for (const k of missing.slice(0, 100)) { const [nm, date] = k.split("|"); diffs.push({ row: 0, name: nm, field: "근무 기록", sheet: date, db: "(없음)", kind: "누락" }); }
    for (const m of valueDiff.slice(0, 100)) diffs.push({ row: 0, name: m.split("|")[0], field: "근무시간", sheet: m, db: "", kind: "값 다름" });
    for (const m of slotDiff.slice(0, 200)) diffs.push({ row: 0, name: m.split("|")[0], field: "근무 타임 체크", sheet: m, db: "", kind: "누락" });
    summary.push({
      area: "근무 기록",
      sheet: sheetMap.size,
      db: dbMap.size,
      ok: missing.length === 0 && valueDiff.length === 0 && slotDiff.length === 0,
      note: `날짜 탭 ${tabs} · 시트에만 ${missing.length} · DB에만 ${extra.length} · 시간 다름 ${valueDiff.length} · 타임 체크 시트 ${sheetSlots}칸 / DB ${dbSlots}칸 (불일치 ${slotDiff.length}행)`,
    });
    log(`  근무: 시트 ${sheetMap.size}행 · DB ${dbMap.size}행 · 시트에만 ${missing.length} · 시간 다름 ${valueDiff.length} · 타임 체크 ${sheetSlots} → ${dbSlots}`);
  }

  // ---------- 5. 상담 ----------
  // 주간 상담일지의 주차 칸과 개인 탭의 날짜별 칸을 각각 본문 앞 20자까지 맞춰 본다.
  if (files.counsel) {
    const book = readBook(path(files.counsel));
    const head = (t: string) => t.replace(/\s+/g, "").slice(0, 20);
    const sheetTexts: { name: string; where: string; text: string }[] = [];
    const wk = book["주간 상담일지"];
    if (wk) {
      for (let r = 1; r < wk.length; r++) {
        const name = (wk[r][1] ?? "").trim();
        if (!name) continue;
        for (let c = 6; c < (wk[0] ?? []).length; c++) {
          const t = (wk[r][c] ?? "").trim();
          if (t && /\d주차/.test(wk[0][c] ?? "")) sheetTexts.push({ name: name.replace(/\s+/g, ""), where: `주간 ${wk[0][c]}`, text: head(t) });
        }
      }
    }
    for (const [tabName, g] of Object.entries(book)) {
      if (tabName === "주간 상담일지" || /템플릿/.test(tabName)) continue;
      const r1 = g[0] ?? [];
      const ni = r1.findIndex((v) => v === "이름");
      const name = (ni >= 0 ? r1[ni + 1] : tabName.replace(/^\d+\s*/, "")).replace(/\s+/g, "");
      const hdr = g.findIndex((row) => row.some((v) => /원장/.test(v ?? "")));
      const cI = hdr >= 0 ? g[hdr].findIndex((v) => /원장/.test(v ?? "")) : 1;
      const cR = hdr >= 0 ? g[hdr].findIndex((v) => /선생님|멘토/.test(v ?? "")) : 4;
      for (let r = hdr + 1; r < g.length; r++) {
        for (const [c, label] of [[cI, "원장"], [cR, "선생님"]] as [number, string][]) {
          if (c < 0) continue;
          const t = (g[r][c] ?? "").trim();
          if (t) sheetTexts.push({ name, where: `${tabName} ${r}행 ${label}`, text: head(t) });
        }
      }
    }
    const dbRows = await db.execute<{ name: string; t: string }>(
      `select replace(m.name,' ','') as name, x.t from counsel_logs c join members m on m.id = c.member_id,
        lateral (values (c.issue_text), (c.resolution_text)) as x(t)
       where c.branch_id = '${branch.id}' and x.t is not null and x.t <> ''` as never,
    );
    const dbBag = new Map<string, number>();
    for (const r of dbRows) { const k = `${r.name}|${head(r.t)}`; dbBag.set(k, (dbBag.get(k) ?? 0) + 1); }
    const missing = sheetTexts.filter((x) => {
      const k = `${x.name}|${x.text}`;
      const n = dbBag.get(k) ?? 0;
      if (n > 0) { dbBag.set(k, n - 1); return false; }
      return true;
    });
    for (const m of missing.slice(0, 200)) diffs.push({ row: 0, name: m.name, field: "상담일지", sheet: `${m.where}: ${m.text}…`, db: "(없음)", kind: "누락" });
    const leftover = [...dbBag.values()].reduce((a, b) => a + b, 0);
    summary.push({
      area: "상담일지",
      sheet: sheetTexts.length,
      db: dbRows.length,
      ok: missing.length === 0,
      note: `시트 본문 ${sheetTexts.length}칸 · DB ${dbRows.length}칸 · 시트에만 ${missing.length} · DB에만 ${leftover}`,
    });
    log(`  상담: 시트 ${sheetTexts.length}칸 · DB ${dbRows.length}칸 · 시트에만 ${missing.length} · DB에만 ${leftover}`);
  }

  // ---------- 6. 모의고사 ----------
  // 고객정보 파일의 모의고사 탭: 월 블록마다 (이름·회차) 신청 여부와 결제일을 본다.
  if (files.members) {
    const book = readBook(path(files.members));
    const entry = Object.entries(book).find(([n]) => n.startsWith("모의고사"));
    if (entry) {
      const [tabName, g] = entry;
      const price = Number(((tabName.match(/(\d[\d,]*)원/) ?? [])[1] ?? "0").replace(/,/g, "")) || 0;
      const blocks: { col: number; ym: string }[] = [];
      (g[0] ?? []).forEach((v, c) => {
        const m = (v ?? "").match(/(\d{4})년\s*(\d{1,2})월/);
        if (m) blocks.push({ col: c, ym: `${m[1]}-${m[2].padStart(2, "0")}` });
      });
      const sheetMap = new Map<string, { applied: boolean; paidAt: string | null }>();
      for (const b of blocks) {
        const hdr = (g[1] ?? []).slice(b.col, b.col + 9);
        const ci = (label: string) => { const i = hdr.findIndex((h) => (h ?? "").trim() === label); return i < 0 ? -1 : b.col + i; };
        const cName = ci("성명"), cApplied = ci("신청여부"), cPaid = ci("결제일");
        if (cName < 0) continue;
        for (let r = 2; r < g.length; r++) {
          const name = (g[r][cName] ?? "").trim();
          if (!name) continue;
          const paidRaw = cPaid >= 0 ? (g[r][cPaid] ?? "").trim() : "";
          const paidAt = /^\d{4}-\d{2}-\d{2}/.test(paidRaw) ? paidRaw.slice(0, 10) : null;
          const applied = cApplied >= 0 ? truthy(g[r][cApplied] ?? "") || !!paidAt : true;
          sheetMap.set(`${name.replace(/\s+/g, "")}|${b.ym}`, { applied, paidAt });
        }
      }
      const dbRows = await db.execute<{ k: string; applied: boolean; paid_at: string | null }>(
        `select replace(m.name,' ','')||'|'||rd.year_month as k, a.applied, a.paid_at::text as paid_at
         from mock_exam_applications a join mock_exam_rounds rd on rd.id = a.round_id join members m on m.id = a.member_id
         where rd.branch_id = '${branch.id}'` as never,
      );
      const dbMap = new Map(dbRows.map((r) => [r.k, { applied: r.applied, paidAt: r.paid_at }]));
      const missing: string[] = [], valueDiff: string[] = [];
      for (const [k, v] of sheetMap) {
        const d = dbMap.get(k);
        if (!d) { missing.push(k); continue; }
        if (d.applied !== v.applied || (d.paidAt ?? null) !== (v.paidAt ?? null)) valueDiff.push(`${k} 시트 신청${v.applied ? "O" : "X"}/${v.paidAt ?? "-"} · DB 신청${d.applied ? "O" : "X"}/${d.paidAt ?? "-"}`);
      }
      const extra = [...dbMap.keys()].filter((k) => !sheetMap.has(k));
      for (const k of missing.slice(0, 100)) { const [nm, ym] = k.split("|"); diffs.push({ row: 0, name: nm, field: "모의고사 신청", sheet: ym, db: "(없음)", kind: "누락" }); }
      for (const m of valueDiff.slice(0, 100)) diffs.push({ row: 0, name: m.split("|")[0], field: "모의고사", sheet: m, db: "", kind: "값 다름" });
      summary.push({
        area: "모의고사",
        sheet: sheetMap.size,
        db: dbMap.size,
        ok: missing.length === 0 && valueDiff.length === 0,
        note: `회차 ${blocks.length}개 · 1인 ${price.toLocaleString("ko-KR")}원 · 시트에만 ${missing.length} · DB에만 ${extra.length} · 값 다름 ${valueDiff.length}`,
      });
      log(`  모의고사: 시트 ${sheetMap.size} · DB ${dbMap.size} · 시트에만 ${missing.length} · 값 다름 ${valueDiff.length}`);
    }
  }

  // ---------- 보고서 ----------
  const esc = (v: string) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const hard = diffs.filter((d) => d.kind !== "의도된 변환");
  const soft = diffs.filter((d) => d.kind === "의도된 변환");
  const byField = (list: Diff[]) => {
    const m = new Map<string, number>();
    for (const d of list) m.set(d.field, (m.get(d.field) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const rowsHtml = (list: Diff[]) => list.map((d) => `<tr><td>${d.row}</td><td>${esc(d.name)}</td><td>${esc(d.field)}</td><td class="s">${esc(d.sheet)}</td><td class="d">${esc(d.db)}</td></tr>`).join("");

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>시트 대사 결과 · ${esc(branch.name)}</title><style>
:root{--ink:#20242e;--ink2:#5b6270;--rule:#e3e0d9;--paper:#f8f6f2;--card:#fff;--bad:#b3261e;--good:#1f7a4d;--brass:#9a7b2e}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;word-break:keep-all}
.w{max-width:60rem;margin:0 auto;padding:2rem 1.25rem 4rem}
h1{font-size:1.8rem;margin:0 0 .5rem;letter-spacing:-.02em}h2{font-size:1.2rem;margin:2.5rem 0 .75rem;padding-top:1rem;border-top:2px solid var(--ink)}
.warn{border-left:3px solid var(--bad);padding:.4rem 0 .4rem 1rem;margin:1rem 0;color:var(--ink2)}
table{width:100%;border-collapse:collapse;font-size:.86rem;margin-bottom:1.5rem}th,td{text-align:left;padding:.45rem .7rem .45rem 0;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-size:.75rem;letter-spacing:.05em;color:var(--ink2)}td.s{color:var(--bad)}td.d{color:var(--ink2)}
.big{display:flex;gap:2.5rem;flex-wrap:wrap;margin:1.5rem 0;padding:1rem 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.big div b{display:block;font-size:2rem;line-height:1.1;font-variant-numeric:tabular-nums}.big div span{font-size:.78rem;color:var(--ink2)}
.ok b{color:var(--good)}.no b{color:var(--bad)}.mid b{color:var(--brass)}
.scroll{overflow-x:auto}code{font-family:ui-monospace,monospace;font-size:.85em}
</style></head><body><div class="w">
<h1>시트 ↔ DB 대사 결과</h1>
<p style="color:var(--ink2);margin:0 0 1rem">${esc(branch.name)}(${esc(branch.code)}) · ${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)} · 시트 원본 셀을 적재 파서를 거치지 않고 직접 읽어 DB와 대조했습니다.</p>
<div class="warn"><b>이 파일에는 학생 실명과 연락처가 들어 있습니다.</b> 저장소에 커밋하거나 외부로 보내지 마세요.</div>
<div class="big">
  <div class="${hard.length ? "no" : "ok"}"><b>${hard.length}</b><span>값 불일치 (확인 필요)</span></div>
  <div class="${sheetOnly.length ? "no" : "ok"}"><b>${sheetOnly.length}</b><span>시트에만 있음 (누락)</span></div>
  <div class="mid"><b>${soft.length}</b><span>의도된 변환</span></div>
  <div><b>${dbOnly.length}</b><span>DB에만 있음</span></div>
</div>

<h2>영역별 건수</h2><div class="scroll"><table><thead><tr><th>영역</th><th>시트</th><th>DB</th><th>메모</th></tr></thead><tbody>
${summary.map((x) => `<tr><td>${esc(x.area)}</td><td>${x.sheet || "-"}</td><td>${x.db}</td><td>${esc(x.note)}</td></tr>`).join("")}
</tbody></table></div>

<h2>값 불일치 ${hard.length}건 ${hard.length ? "— 확인이 필요합니다" : "— 없습니다"}</h2>
${hard.length ? `<p>필드별: ${byField(hard).map(([f, n]) => `${esc(f)} ${n}`).join(" · ")}</p><div class="scroll"><table><thead><tr><th>시트 행</th><th>이름</th><th>항목</th><th>시트 값</th><th>DB 값</th></tr></thead><tbody>${rowsHtml(hard)}</tbody></table></div>` : "<p>시트의 모든 값이 DB와 같습니다.</p>"}

<h2>시트에만 있고 DB에 없는 회원 ${sheetOnly.length}명</h2>
${sheetOnly.length ? `<div class="scroll"><table><thead><tr><th>시트 행</th><th>이름</th><th>좌석 칸</th></tr></thead><tbody>${sheetOnly.map((x) => `<tr><td>${x.row}</td><td>${esc(x.name)}</td><td>${esc(x.seatNo)}</td></tr>`).join("")}</tbody></table></div>` : "<p>없습니다. 시트의 모든 회원이 DB에 있습니다.</p>"}

<h2>DB에만 있는 회원 ${dbOnly.length}명</h2>
<p style="color:var(--ink2)">라운딩·식사·근무 시트에는 이름이 있는데 고객정보 시트에는 없는 사람입니다. 적재할 때 자리표시로 만들어 기록을 붙여 둔 것이라 정상일 수 있습니다. 실제로 재원 중이면 고객정보 시트에 추가해 주세요.</p>
${dbOnly.length ? `<div class="scroll"><table><thead><tr><th>이름</th><th>좌석</th><th>상태</th></tr></thead><tbody>${dbOnly.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.seatNo ?? "-"}</td><td>${esc(x.status)}</td></tr>`).join("")}</tbody></table></div>` : ""}

<h2>의도된 변환 ${soft.length}건</h2>
<p style="color:var(--ink2)">규칙에 따라 일부러 바꾼 것입니다. 규칙이 틀렸다고 판단되면 알려 주세요.</p>
${soft.length ? `<p>필드별: ${byField(soft).map(([f, n]) => `${esc(f)} ${n}`).join(" · ")}</p><div class="scroll"><table><thead><tr><th>시트 행</th><th>이름</th><th>항목</th><th>시트 값</th><th>DB 값</th></tr></thead><tbody>${rowsHtml(soft)}</tbody></table></div>` : ""}
</div></body></html>`;

  const out = join(outDir, "대사결과.html");
  writeFileSync(out, html);
  log(`\n== 값 불일치 ${hard.length} · 누락 ${sheetOnly.length} · 의도된 변환 ${soft.length} · DB에만 ${dbOnly.length}`);
  log(`== 상세(실명 포함): ${out}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
