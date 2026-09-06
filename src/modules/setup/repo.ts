import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { boardItems, branches, mealSettings, memberships, penaltyRules, seats, users } from "@/db/schema";
import { hashPassword, validatePassword } from "@/lib/auth/password";
import { ValidationError } from "@/lib/errors";

/** 사용자가 한 명도 없으면 처음 설정이 필요한 상태 */
export async function needsSetup(db: Db = defaultDb): Promise<boolean> {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  return !u;
}

/** 본사 기본 벌점 규칙·현황판 항목이 비어 있으면 넣는다 (있으면 손대지 않음) */
export async function ensureDefaults(db: Db = defaultDb): Promise<{ rules: boolean; items: boolean }> {
  const out = { rules: false, items: false };
  const [rule] = await db.select({ id: penaltyRules.id }).from(penaltyRules).limit(1);
  if (!rule) {
    await db.insert(penaltyRules).values([
      { name: "이동금지 위반", points: 5, sort: 1 },
      { name: "휴대폰 전원 미차단", points: 2, sort: 2 },
      { name: "무단 미등원", points: 8, sort: 3 },
      { name: "졸음", points: 3, sort: 4 },
      { name: "연속 졸음", points: 6, sort: 5 },
      { name: "지각", points: 4, sort: 6 },
    ]);
    out.rules = true;
  }
  const [item] = await db.select({ id: boardItems.id }).from(boardItems).limit(1);
  if (!item) {
    await db.insert(boardItems).values([
      { key: "attendance", label: "출석", kind: "daily", sort: 1 },
      { key: "planner", label: "플래너", kind: "daily", sort: 2 },
      { key: "round", label: "라운딩", kind: "round", sort: 3 },
      { key: "vocab", label: "영단어", kind: "daily", sort: 4 },
      { key: "checkout", label: "점검완료", kind: "daily", sort: 5 },
    ]);
    out.items = true;
  }
  return out;
}

export type SetupInput = {
  hqLoginId: string;
  hqName: string;
  hqPassword: string;
  branch?: { code: string; name: string; seatCount: number; roundsPerDay: number; managerLoginId?: string; managerName?: string; managerPassword?: string } | null;
};

const LOGIN_RE = /^[a-zA-Z0-9_.-]{2,30}$/;
const CODE_RE = /^[A-Z0-9_-]{2,10}$/;

/**
 * 처음 설정: 본사 관리자 + 기본 규칙 + (선택) 첫 지점과 지점장. 사용자가 이미 있으면 거부한다.
 * 운영 DB 에 시드 대신 쓰는 진입점이며, 웹 화면(/setup)과 scripts/bootstrap.ts 가 함께 쓴다.
 */
export async function runSetup(input: SetupInput, db: Db = defaultDb): Promise<{ hqUserId: string; branchId: string | null }> {
  if (!(await needsSetup(db))) throw new ValidationError("이미 설정이 끝났습니다. 로그인 화면으로 이동하세요");
  const hqLoginId = input.hqLoginId.trim();
  if (!LOGIN_RE.test(hqLoginId)) throw new ValidationError("본사 아이디는 영문·숫자 2~30자");
  if (!input.hqName.trim()) throw new ValidationError("본사 담당자 이름을 입력하세요");
  const pwErr = validatePassword(input.hqPassword);
  if (pwErr) throw new ValidationError(`본사 비밀번호: ${pwErr}`);
  const b = input.branch;
  let code = "";
  if (b) {
    code = b.code.trim().toUpperCase();
    if (!CODE_RE.test(code)) throw new ValidationError("지점 코드는 영문 대문자·숫자 2~10자");
    if (!b.name.trim()) throw new ValidationError("지점 이름을 입력하세요");
    if (!Number.isInteger(b.seatCount) || b.seatCount < 0 || b.seatCount > 500) throw new ValidationError("좌석 수는 0~500");
    if (!Number.isInteger(b.roundsPerDay) || b.roundsPerDay < 1 || b.roundsPerDay > 24) throw new ValidationError("하루 회차는 1~24");
    if (b.managerLoginId) {
      if (!LOGIN_RE.test(b.managerLoginId.trim())) throw new ValidationError("지점장 아이디는 영문·숫자 3~30자");
      if (b.managerLoginId.trim() === hqLoginId) throw new ValidationError("지점장 아이디는 본사 아이디와 달라야 합니다");
      const mErr = validatePassword(b.managerPassword ?? "");
      if (mErr) throw new ValidationError(`지점장 비밀번호: ${mErr}`);
    }
  }

  const hqHash = await hashPassword(input.hqPassword);
  const mgrHash = b?.managerLoginId ? await hashPassword(b.managerPassword ?? "") : null;
  return db.transaction(async (tx) => {
    const [hq] = await tx.insert(users).values({ loginId: hqLoginId, name: input.hqName.trim(), passwordHash: hqHash, isHqAdmin: true }).returning({ id: users.id });
    await ensureDefaults(tx);
    let branchId: string | null = null;
    if (b) {
      const [existing] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.code, code)).limit(1);
      if (existing) throw new ValidationError(`지점 코드 ${code} 는 이미 있습니다`);
      const [br] = await tx
        .insert(branches)
        .values({ code, name: b.name.trim(), settings: { roundsPerDay: b.roundsPerDay, maskNames: false } })
        .returning({ id: branches.id });
      branchId = br.id;
      if (b.seatCount > 0) await tx.insert(seats).values(Array.from({ length: b.seatCount }, (_, i) => ({ branchId: br.id, seatNo: i + 1, zone: "A", sort: i + 1 })));
      await tx.insert(mealSettings).values({ branchId: br.id });
      if (b.managerLoginId && mgrHash) {
        const [m] = await tx.insert(users).values({ loginId: b.managerLoginId.trim(), name: (b.managerName ?? "").trim() || "지점장", passwordHash: mgrHash }).returning({ id: users.id });
        await tx.insert(memberships).values({ userId: m.id, branchId: br.id, role: "branch_manager" });
      }
    }
    return { hqUserId: hq.id, branchId };
  });
}
