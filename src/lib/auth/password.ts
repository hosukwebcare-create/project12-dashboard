import bcrypt from "bcryptjs";

const ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
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
