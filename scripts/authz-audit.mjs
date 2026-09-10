/**
 * 서버 액션과 저장소 함수가 권한 검사를 빠뜨리지 않았는지 정적으로 훑는다.
 *
 *   node scripts/authz-audit.mjs
 *
 * 지점 격리는 RLS 가 마지막 방어선이지만, 지점 열이 없는 자식 표
 * (handover_reads, member_guardians 같은)에는 RLS 를 걸 수 없다. 그런 표는
 * 부모가 우리 지점 것인지 코드에서 확인해야 하고, 그 확인을 빠뜨렸는지를 본다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const files = walk("src/modules");
const problems = [];

for (const f of files.filter((x) => x.endsWith("actions.ts"))) {
  const src = readFileSync(f, "utf8");
  for (const [, name, , body] of src.matchAll(/export async function (\w+)\s*\(([\s\S]*?)\)\s*:\s*Promise<[^>]*>\s*\{([\s\S]*?)\n\}/g)) {
    if (!/withRequestRls|withRls/.test(body)) problems.push(`${f} · ${name}(): withRequestRls 없이 DB 를 만진다`);
    if (!/getCtx\(\)/.test(body)) problems.push(`${f} · ${name}(): getCtx 없음`);
  }
}

// ctx 를 받는 쓰기 함수는 스스로 권한을 확인해야 한다.
// 다른 함수를 거쳐 확인되는 경우가 있어(markAllRead → listNotes) 호출도 함께 본다.
const WRITE = /^(create|update|upsert|delete|remove|set|save|add|bulk|mark|change|assign|transfer|unlock|ingest|complete|start|resolve|reopen|send|issue)/i;
const GUARD = /requireRole|requireHq|findOwned|getNote\(ctx|getMember\(ctx|listNotes\(ctx|ctx\.role\s*!==/;
for (const f of files.filter((x) => x.endsWith("repo.ts"))) {
  const src = readFileSync(f, "utf8");
  for (const [, name, args, body] of src.matchAll(/export async function (\w+)\(([^)]*)\)([\s\S]*?)(?=\nexport |\n\/\*\*|$)/g)) {
    if (!WRITE.test(name) || !/ctx:\s*Ctx/.test(args)) continue;
    if (!GUARD.test(body)) problems.push(`${f} · ${name}(): 권한·소유 확인이 보이지 않는다`);
  }
}

if (problems.length) {
  console.log(problems.join("\n"));
  console.log(`\n== ${problems.length}건`);
  process.exit(1);
}
console.log(`서버 액션·저장소 권한 검사: 문제 없음 (파일 ${files.length}개)`);
