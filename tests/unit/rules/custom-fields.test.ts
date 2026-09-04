import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { validateCustomValues, type CustomFieldSpec } from "@/lib/rules/custom-fields";

const defs: CustomFieldSpec[] = [
  { key: "cram_school", label: "학원", type: "select", options: ["A학원", "B학원"], required: false },
  { key: "target_score", label: "목표 점수", type: "number", options: [], required: true },
  { key: "subjects", label: "선택 과목", type: "multiselect", options: ["물리", "화학", "생명"], required: false },
  { key: "bus", label: "셔틀 이용", type: "boolean", options: [], required: false },
  { key: "exam_date", label: "시험일", type: "date", options: [], required: false },
  { key: "note2", label: "비고2", type: "text", options: [], required: false },
];

describe("validateCustomValues", () => {
  it("타입별로 값을 정규화한다", () => {
    const out = validateCustomValues(defs, {
      cram_school: "A학원",
      target_score: "90",
      subjects: ["물리", "화학"],
      bus: "on",
      exam_date: "2026-11-19",
      note2: "  메모  ",
    });
    expect(out).toEqual({ cram_school: "A학원", target_score: 90, subjects: ["물리", "화학"], bus: true, exam_date: "2026-11-19", note2: "메모" });
  });

  it("필수값이 비면 오류", () => {
    expect(() => validateCustomValues(defs, { cram_school: "A학원" })).toThrow(ValidationError);
    expect(() => validateCustomValues(defs, { target_score: "" })).toThrow(/목표 점수/);
  });

  it("선택지에 없는 값은 오류", () => {
    expect(() => validateCustomValues(defs, { target_score: 1, cram_school: "C학원" })).toThrow(/학원/);
    expect(() => validateCustomValues(defs, { target_score: 1, subjects: ["물리", "지구"] })).toThrow(/선택 과목/);
  });

  it("숫자·날짜 형식 오류", () => {
    expect(() => validateCustomValues(defs, { target_score: "abc" })).toThrow(/목표 점수/);
    expect(() => validateCustomValues(defs, { target_score: 1, exam_date: "11/19" })).toThrow(/시험일/);
  });

  it("빈 선택값은 null, 정의에 없는 키는 버린다", () => {
    const out = validateCustomValues(defs, { target_score: 5, cram_school: "", unknown: "x", bus: undefined });
    expect(out).toEqual({ target_score: 5, cram_school: null, bus: false });
    expect("unknown" in out).toBe(false);
  });

  it("문자열 하나로 온 multiselect도 배열로 받는다", () => {
    expect(validateCustomValues(defs, { target_score: 1, subjects: "화학" }).subjects).toEqual(["화학"]);
  });
});
