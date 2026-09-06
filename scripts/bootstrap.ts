/**
 * 운영 DB 최초 세팅. 본사 관리자 계정을 만들고(없을 때만), 필요하면 첫 지점과 지점장까지 만든다.
 * 시드(src/db/seed.ts)는 가상 데이터용이라 운영에는 쓰지 않는다.
 *
 *   DATABASE_URL=postgres://... pnpm exec tsx scripts/bootstrap.ts \
 *     --hq-login hq --hq-name "본사운영" --hq-password "긴비밀번호12" \
 *     [--branch-code DT2 --branch-name 동탄2 --seats 77 --rounds 11 --manager-login manager --manager-name 박원장 --manager-password "긴비밀번호34"]
 *
 * 벌점 규칙·현황판 항목의 본사 기본값도 비어 있으면 함께 넣는다.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as s from "@/db/schema";
import { hashPassword, validatePassword } from "@/lib/auth/password";
import { ensureDefaults } from "@/modules/setup/repo";

const argv = process.argv.slice(2);
const opt = (k: string, d = ""): string => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};

async function main() {
  const hqLogin = opt("hq-login", "hq");
  const hqName = opt("hq-name", "본사운영");
  const hqPassword = opt("hq-password");
  if (!hqPassword) throw new Error("--hq-password 가 필요합니다");
  const pwErr = validatePassword(hqPassword);
  if (pwErr) throw new Error(`본사 비밀번호: ${pwErr}`);

  const [existingHq] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.loginId, hqLogin)).limit(1);
  if (existingHq) console.log(`본사 관리자 '${hqLogin}' 은 이미 있습니다 (건너뜀)`);
  else {
    await db.insert(s.users).values({ loginId: hqLogin, name: hqName, passwordHash: await hashPassword(hqPassword), isHqAdmin: true });
    console.log(`본사 관리자 '${hqLogin}' 생성`);
  }

  const defaults = await ensureDefaults();
  if (defaults.rules) console.log("본사 기본 벌점 규칙 6개 생성");
  if (defaults.items) console.log("본사 기본 현황판 항목 5개 생성");

  const code = opt("branch-code").toUpperCase();
  if (code) {
    const [existing] = await db.select({ id: s.branches.id }).from(s.branches).where(eq(s.branches.code, code)).limit(1);
    if (existing) console.log(`지점 '${code}' 은 이미 있습니다 (건너뜀)`);
    else {
      const rounds = Number(opt("rounds", "12"));
      const seatCount = Number(opt("seats", "50"));
      const [b] = await db
        .insert(s.branches)
        .values({ code, name: opt("branch-name", code), settings: { roundsPerDay: rounds, maskNames: false } })
        .returning();
      if (seatCount > 0) await db.insert(s.seats).values(Array.from({ length: seatCount }, (_, i) => ({ branchId: b.id, seatNo: i + 1, zone: "A", sort: i + 1 })));
      await db.insert(s.mealSettings).values({ branchId: b.id });
      console.log(`지점 '${b.name}' 생성 (좌석 ${seatCount}, 회차 ${rounds})`);
      const mLogin = opt("manager-login");
      if (mLogin) {
        const mPw = opt("manager-password");
        const err = mPw ? validatePassword(mPw) : "필요합니다";
        if (err) throw new Error(`지점장 비밀번호: ${err}`);
        const [m] = await db.insert(s.users).values({ loginId: mLogin, name: opt("manager-name", "지점장"), passwordHash: await hashPassword(mPw) }).returning();
        await db.insert(s.memberships).values({ userId: m.id, branchId: b.id, role: "branch_manager" });
        console.log(`지점장 '${mLogin}' 생성`);
      }
    }
  }
  console.log("완료. 로그인 후 설정 › 사용자에서 멘토·조교 계정과 PIN 을 추가하세요.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
