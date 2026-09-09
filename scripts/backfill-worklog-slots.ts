/**
 * 이미 적재된 근무 기록에 '어느 타임에 일했는지'를 되메운다.
 *
 *   DATABASE_URL=... pnpm exec tsx scripts/backfill-worklog-slots.ts --branch DT2 \
 *     --worklog ~/Downloads/"조교근무일지(2026)_ 동탄2.xlsx" [--apply]
 *
 * 왜 따로 필요한가: 적재 당시 지점에 근무 타임(shift_slots)이 없어서 시트의
 * 1~7타임·일1/일2타임 체크가 통째로 버려졌다. migrate-sheets.ts 는 고쳤지만
 * 전체 재적재는 다른 데이터까지 지우고 다시 넣는다. 이 스크립트는 work_logs 의
 * slot_keys 만 채우고 근무시간·초과근무·본사확인은 손대지 않는다.
 *
 * --apply 없이 돌리면 무엇이 바뀔지만 보여준다(기본값). 실명은 찍지 않는다.
 */
import { existsSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db/client";
import * as s from "@/db/schema";

const argv = process.argv.slice(2);
const opt = (k: string, d = ""): string => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const branchCode = opt("branch", "DT2");
const file = opt("worklog").replace(/^~/, process.env.HOME ?? "");
const apply = argv.includes("--apply");

function fmt(c: unknown): string {
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${c.getFullYear()}-${p(c.getMonth() + 1)}-${p(c.getDate())}`;
  }
  if (typeof c === "number") return String(c);
  return String(c ?? "").trim();
}

async function main() {
  if (!file || !existsSync(file)) throw new Error(`--worklog 파일이 필요합니다: ${file}`);
  const [branch] = await db.select().from(s.branches).where(eq(s.branches.code, branchCode));
  if (!branch) throw new Error(`지점 ${branchCode} 이(가) 없습니다`);

  const slots = await db.select().from(s.shiftSlots).where(eq(s.shiftSlots.branchId, branch.id));
  if (!slots.length) throw new Error("이 지점에 근무 타임이 없습니다. 근무 › 타임·직원 설정에서 먼저 만드세요");
  const keyByLabel = new Map(slots.map((x) => [x.label.replace(/\s+/g, ""), x.key]));

  const staff = await db
    .select({ id: s.users.id, name: s.users.name })
    .from(s.memberships)
    .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
    .where(eq(s.memberships.branchId, branch.id));
  const userByName = new Map(staff.map((u) => [u.name.replace(/\s+/g, ""), u.id]));

  const wb = XLSX.readFile(file, { cellDates: true });
  const FORMS = new Set(["주간조교", "야간조교", "원장", "컨설팅", "선생님"]);
  /** (userId|date) → 타임 키 목록 */
  const want = new Map<string, string[]>();
  const unknownLabels = new Set<string>();
  let unknownStaff = 0;

  for (const tabName of wb.SheetNames) {
    if (!/^\d{1,2}\.\d{1,2}$/.test(tabName)) continue;
    const g = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[tabName], { header: 1, raw: true, defval: "" }).map((r) => r.map(fmt));
    const date = /^\d{4}-\d{2}-\d{2}/.test(g[0]?.[0] ?? "") ? g[0][0].slice(0, 10) : null;
    const hdr = g.findIndex((row) => row[0] === "근무자");
    if (!date || hdr < 0) continue;
    const slotCols: { c: number; key: string }[] = [];
    g[hdr].forEach((h, c) => {
      const label = (h ?? "").replace(/\s+/g, "");
      if (!/^(일)?\d+타임$/.test(label)) return;
      const key = keyByLabel.get(label);
      if (key) slotCols.push({ c, key });
      else unknownLabels.add(label);
    });
    for (let r = hdr + 1; r < g.length; r++) {
      const name = (g[r][0] ?? "").replace(/\s+/g, "");
      const form = (g[r][1] ?? "").trim();
      if (!name || !FORMS.has(form)) continue;
      const keys = slotCols.filter((x) => (g[r][x.c] ?? "").toLowerCase() === "true").map((x) => x.key);
      if (!keys.length) continue;
      const userId = userByName.get(name);
      if (!userId) {
        unknownStaff++;
        continue;
      }
      want.set(`${userId}|${date}`, keys);
    }
  }

  const rows = await db
    .select({ id: s.workLogs.id, userId: s.workLogs.userId, date: s.workLogs.date, slotKeys: s.workLogs.slotKeys })
    .from(s.workLogs)
    .where(eq(s.workLogs.branchId, branch.id));
  const byKey = new Map(rows.map((r) => [`${r.userId}|${r.date}`, r]));

  const toUpdate: { id: string; keys: string[] }[] = [];
  let already = 0;
  let noRow = 0;
  for (const [k, keys] of want) {
    const row = byKey.get(k);
    if (!row) {
      noRow++;
      continue;
    }
    const cur = row.slotKeys ?? [];
    if (cur.length === keys.length && cur.every((x, i) => x === keys[i])) {
      already++;
      continue;
    }
    toUpdate.push({ id: row.id, keys });
  }

  console.log(`== 근무 타임 되메우기 · ${branch.name}(${branch.code})`);
  console.log(`  시트에서 읽은 (직원·날짜) ${want.size}건 · 타임 칸 합계 ${[...want.values()].reduce((a, b) => a + b.length, 0)}`);
  console.log(`  DB 근무 기록 ${rows.length}건 중 채울 것 ${toUpdate.length} · 이미 같음 ${already} · 짝이 되는 기록 없음 ${noRow}`);
  if (unknownLabels.size) console.log(`  경고: DB 에 없는 타임 이름 ${[...unknownLabels].join(", ")} — 근무 › 타임·직원 설정에서 만드세요`);
  if (unknownStaff) console.log(`  경고: DB 에 없는 근무자 ${unknownStaff}행 — 이관 때 만들어지지 않은 직원입니다`);

  if (!apply) {
    console.log("\n(--apply 를 주면 실제로 채웁니다. 지금은 아무것도 바꾸지 않았습니다.)");
    process.exit(0);
  }
  // 같은 타임 조합끼리 묶어서 한 번에 업데이트한다
  const groups = new Map<string, string[]>();
  for (const u of toUpdate) {
    const g = JSON.stringify(u.keys);
    groups.set(g, [...(groups.get(g) ?? []), u.id]);
  }
  let done = 0;
  for (const [keysJson, ids] of groups) {
    const keys = JSON.parse(keysJson) as string[];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      await db.update(s.workLogs).set({ slotKeys: keys }).where(and(eq(s.workLogs.branchId, branch.id), inArray(s.workLogs.id, chunk)));
      done += chunk.length;
    }
  }
  console.log(`\n채운 기록 ${done}건`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
