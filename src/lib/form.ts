/** FormData → 중첩 객체. 점 표기(guardian.name)와 같은 이름의 다중 값(체크박스)을 지원한다 */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Array.from(new Set(Array.from(fd.keys())));
  for (const key of keys) {
    const all = fd.getAll(key).filter((v): v is string => typeof v === "string");
    if (all.length === 0) continue;
    const value: string | string[] = all.length > 1 ? all : all[0];
    const parts = key.split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] ??= {};
      cur = cur[parts[i]] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}
