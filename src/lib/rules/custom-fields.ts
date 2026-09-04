import { ValidationError } from "@/lib/errors";

export type CustomFieldType = "text" | "number" | "date" | "select" | "multiselect" | "boolean";
export const CUSTOM_FIELD_TYPES: CustomFieldType[] = ["text", "number", "date", "select", "multiselect", "boolean"];
export const CUSTOM_FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: "텍스트",
  number: "숫자",
  date: "날짜",
  select: "선택(하나)",
  multiselect: "선택(여러 개)",
  boolean: "예/아니오",
};

export type CustomFieldSpec = { key: string; label: string; type: CustomFieldType; options: string[]; required: boolean };

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/** 정의에 따라 값을 정규화·검증한다. 정의에 없는 키는 버린다. */
export function validateCustomValues(defs: CustomFieldSpec[], raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const v = raw[d.key];
    if (d.type === "boolean") {
      out[d.key] = v === true || v === "true" || v === "on" || v === "1";
      continue;
    }
    if (isBlank(v)) {
      if (d.required) throw new ValidationError(`${d.label}: 필수 항목입니다`);
      if (d.key in raw) out[d.key] = null;
      continue;
    }
    switch (d.type) {
      case "text":
        out[d.key] = String(v).trim();
        break;
      case "number": {
        const n = typeof v === "number" ? v : Number(String(v).trim());
        if (!Number.isFinite(n)) throw new ValidationError(`${d.label}: 숫자를 입력하세요`);
        out[d.key] = n;
        break;
      }
      case "date": {
        const s = String(v).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError(`${d.label}: 날짜 형식은 YYYY-MM-DD 입니다`);
        out[d.key] = s;
        break;
      }
      case "select": {
        const s = String(v);
        if (!d.options.includes(s)) throw new ValidationError(`${d.label}: 선택지에 없는 값입니다`);
        out[d.key] = s;
        break;
      }
      case "multiselect": {
        const arr = (Array.isArray(v) ? v : [v]).map(String);
        const bad = arr.find((x) => !d.options.includes(x));
        if (bad !== undefined) throw new ValidationError(`${d.label}: 선택지에 없는 값(${bad})`);
        out[d.key] = arr;
        break;
      }
    }
  }
  return out;
}
