const VAR_RE = /#\{([^}]+)\}/g;

/** 카카오 알림톡 템플릿 변수 표기 #{변수} 를 치환한다. 값이 없으면 빈 문자열 */
export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(VAR_RE, (_, name: string) => {
    const v = vars[name.trim()];
    return v === null || v === undefined ? "" : String(v);
  });
}

export function extractVariables(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(VAR_RE)) {
    const name = m[1].trim();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}
