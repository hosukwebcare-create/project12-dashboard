/**
 * 회원 CSV 이관 리허설. 테스트 DB에 지점·좌석을 만들고 실제 CSV 로 미리보기 → 반영 → 대사(건수 비교)를 돌린다.
 * 실명·연락처는 출력에서 마스킹한다. 시트 파일은 저장소 밖에 둔다.
 *   DATABASE_URL=postgres://byeolha_app:byeolha_app@localhost:5432/byeolha_test \
 *   pnpm exec tsx scripts/import-rehearsal.ts <csv 경로> [--seats 80] [--today 2026-09-06] [--commit]
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, members, memberships, seats, users } from "@/db/schema";
import { buildCtx } from "@/lib/auth/ctx";
import { parseTable } from "@/lib/rules/csv";
import { autoMapHeaders, commitImport, IMPORT_FIELDS, previewImport, type ImportField } from "@/modules/members/import";

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith("--"));
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const seatCount = Number(opt("seats", "80"));
const today = opt("today", new Date().toISOString().slice(0, 10));
const doCommit = args.includes("--commit");
if (!csvPath) throw new Error("CSV 경로를 주세요");
const csvFile: string = csvPath;
if (!/byeolha_(test|e2e|perf)/.test(process.env.DATABASE_URL ?? "")) throw new Error("테스트용 DB 에서만 실행합니다 (DATABASE_URL)");

async function main() {
  const tables = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  await db.execute(sql.raw(`truncate table ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`));
  const [b] = await db.insert(branches).values({ code: "REH", name: "리허설" }).returning();
  await db.insert(seats).values(Array.from({ length: seatCount }, (_, i) => ({ branchId: b.id, seatNo: i + 1, zone: "A", sort: i + 1 })));
  const [mgr] = await db.insert(users).values({ loginId: "reh_mgr", name: "리허설지점장", passwordHash: "x" }).returning();
  await db.insert(memberships).values({ userId: mgr.id, branchId: b.id, role: "branch_manager" });
  const ctx = (await buildCtx(mgr.id, b.id))!;

  const text = readFileSync(csvFile, "utf8");
  const data = parseTable(text);
  const mapping = autoMapHeaders(data[0]);
  const nameCol = Number(Object.entries(mapping).find(([, v]) => v === "name")?.[0] ?? -1);
  const names = new Set(data.slice(1).map((r) => (r[nameCol] ?? "").trim()).filter(Boolean));
  const mask = (s: string) => {
    let out = s;
    for (const n of names) {
      const core = n.replace(/\s*\/.*$/, "");
      for (const v of [n, core]) if (v.length >= 2) out = out.split(v).join(v[0] + "*".repeat(v.length - 1));
    }
    return out.replace(/01\d-?\d{3,4}-?(\d{4})/g, "010-****-$1");
  };

  console.log(`\n== 입력: ${data.length - 1}행, ${data[0].length}열 (오늘=${today}, 좌석 ${seatCount})`);
  console.log("== 자동 매핑");
  data[0].forEach((h, i) => {
    const f = mapping[i] as ImportField | null | undefined;
    console.log(`  ${String(i + 1).padStart(2)} ${h.padEnd(14)} → ${f ? IMPORT_FIELDS.find((x) => x.key === f)?.label : "(사용 안 함)"}`);
  });

  const pv = await previewImport(ctx, data, mapping, today);
  const group = (msgs: { row: number; message: string }[]) => {
    const m = new Map<string, number[]>();
    for (const x of msgs) {
      const key = mask(x.message).replace(/'[^']*'/g, "'…'").replace(/\d+번/g, "N번").replace(/\d+행/g, "N행");
      m.set(key, [...(m.get(key) ?? []), x.row]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  };
  console.log(`\n== 미리보기: 반영 대상 ${pv.rows.length}행, 오류 ${pv.errors.length}건, 경고 ${pv.warnings.length}건`);
  console.log("-- 오류(반영 제외)");
  for (const [k, rows] of group(pv.errors)) console.log(`  ${rows.length}건  ${k}  (행 ${rows.slice(0, 8).join(",")}${rows.length > 8 ? "…" : ""})`);
  console.log("-- 경고");
  for (const [k, rows] of group(pv.warnings)) console.log(`  ${rows.length}건  ${k}  (행 ${rows.slice(0, 8).join(",")}${rows.length > 8 ? "…" : ""})`);

  const count = <T,>(xs: T[], f: (x: T) => string) => {
    const c = new Map<string, number>();
    for (const x of xs) c.set(f(x), (c.get(f(x)) ?? 0) + 1);
    return [...c.entries()].map(([k, v]) => `${k}=${v}`).join(", ");
  };
  console.log("\n== 파싱 결과 분포");
  console.log("  상태:", count(pv.rows, (r) => r.status));
  console.log("  좌석 배정:", count(pv.rows, (r) => (r.seatNo !== null ? "있음" : "없음")));
  console.log("  구분:", count(pv.rows, (r) => r.memberKind), "| 단기:", count(pv.rows, (r) => r.planType));
  console.log("  연락처:", count(pv.rows, (r) => (r.phone ? "있음" : "없음")), "| 생년월일:", count(pv.rows, (r) => (r.birthDate ? "있음" : "없음")));
  console.log("  등록기간:", count(pv.rows, (r) => (r.enrollStart && r.enrollEnd ? "있음" : "없음")), "| 계열:", count(pv.rows, (r) => r.track ?? "없음"));
  console.log("  학교/학년:", count(pv.rows, (r) => (r.school ? (r.grade ? "학교+학년" : "학교만") : "없음")), "| 집중관리:", count(pv.rows, (r) => String(r.focusCare)));
  console.log("  보호자:", count(pv.rows, (r) => (r.guardianName || r.guardianPhone ? "있음" : "없음")));

  if (!doCommit) {
    console.log("\n(--commit 을 주면 반영과 대사까지 진행)");
    return;
  }
  const errRows = new Set(pv.errors.map((e) => e.row));
  const okRows = pv.rows.filter((r) => !errRows.has(r.row));
  const result = await commitImport(ctx, okRows);
  const [agg] = await db.execute<{ total: string; enrolled: string; prospect: string; withdrawn: string; paused: string; seated: string }>(sql`
    select count(*) total,
      count(*) filter (where status = 'enrolled') enrolled,
      count(*) filter (where status = 'prospect') prospect,
      count(*) filter (where status = 'withdrawn') withdrawn,
      count(*) filter (where status = 'paused') paused,
      count(*) filter (where seat_id is not null) seated
    from ${members}`);
  console.log("\n== 대사 (시트 → DB)");
  console.log(`  시트 데이터 행      ${data.length - 1}`);
  console.log(`  반영 제외(오류)     ${errRows.size}`);
  console.log(`  신규 생성 / 갱신    ${result.created} / ${result.updated}`);
  console.log(`  DB 회원 수          ${agg.total}  (등록 ${agg.enrolled}, 상담 ${agg.prospect}, 휴원 ${agg.paused}, 퇴원 ${agg.withdrawn}, 좌석 배정 ${agg.seated})`);
  const ok = Number(agg.total) === result.created + result.updated && Number(agg.total) + errRows.size === data.length - 1 + result.updated;
  console.log(`  건수 일치            ${ok ? "OK" : "불일치"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
