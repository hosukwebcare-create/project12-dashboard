import bcrypt from "bcryptjs";

/** bcrypt 비용. 10 → 12 로 올렸다(2026-10). 예전 해시는 다음 로그인 때 다시 만든다(needsRehash) */
const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

/** 저장된 해시가 지금 기준보다 약하면 true. 로그인에 성공했을 때 새 기준으로 다시 저장한다 */
export function needsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) < ROUNDS;
  } catch {
    return false;
  }
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** 새 비밀번호 정책: 10자 이상, 영문과 숫자 포함 (설계서 9장) */
export function validatePassword(pw: string): string | null {
  if (pw.length < 10) return "비밀번호는 10자 이상이어야 합니다";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "비밀번호는 영문과 숫자를 모두 포함해야 합니다";
  return null;
}
