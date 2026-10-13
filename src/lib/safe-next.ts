/**
 * 로그인 뒤 돌아갈 주소(next)가 우리 사이트 안의 경로인지 본다. 아니면 null.
 * "//evil.com", "/\\evil.com"(브라우저가 //evil.com 으로 읽는다), 제어 문자·공백이 섞인 것, 다른 출처로 풀리는 것을 모두 거부한다.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || next.length > 512) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return null;
  try {
    const base = "https://internal.invalid";
    const u = new URL(next, base);
    if (u.origin !== base) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}
