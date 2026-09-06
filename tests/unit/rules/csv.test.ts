import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/rules/csv";
import { parsePeriod, splitNameSuffix, splitSchoolGrade, statusFromToken } from "@/lib/rules/import-parsers";

describe("parseCsv", () => {
  it("쉼표·따옴표·이스케이프·CRLF를 처리한다", () => {
    const text = '이름,메모\r\n"김, 철수","그는 ""천재""다"\r\n홍길동,\n';
    expect(parseCsv(text)).toEqual([
      ["이름", "메모"],
      ["김, 철수", '그는 "천재"다'],
      ["홍길동", ""],
    ]);
  });
  it("BOM을 제거하고 따옴표 안의 줄바꿈을 유지한다", () => {
    expect(parseCsv('﻿a,b\n"x\ny",z')).toEqual([
      ["a", "b"],
      ["x\ny", "z"],
    ]);
  });
  it("빈 줄은 건너뛴다", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("import parsers", () => {
  it("이름 뒤 /S 는 단기 표시", () => {
    expect(splitNameSuffix("이상윤/S")).toEqual({ name: "이상윤", short: true, tag: null });
    expect(splitNameSuffix("이상윤")).toEqual({ name: "이상윤", short: false, tag: null });
    expect(splitNameSuffix(" 장은진 /s ")).toEqual({ name: "장은진", short: true, tag: null });
  });
  it("학교명/학년 '한백고3' → 학교·학년", () => {
    expect(splitSchoolGrade("한백고3")).toEqual({ school: "한백고", grade: "3" });
    expect(splitSchoolGrade("가온고 2")).toEqual({ school: "가온고", grade: "2" });
    expect(splitSchoolGrade("반수")).toEqual({ school: "반수", grade: null });
    expect(splitSchoolGrade("")).toEqual({ school: null, grade: null });
  });
  it("기간 표기 '7월16~8월17일[33일]' → 날짜 (연도는 기준일 기준)", () => {
    expect(parsePeriod("7월16~8월17일[33일]", "2026-09-05")).toEqual({ startDate: "2026-07-16", endDate: "2026-08-17" });
    expect(parsePeriod("7월21일~8월17일 [28일]", "2026-09-05")).toEqual({ startDate: "2026-07-21", endDate: "2026-08-17" });
    // 연말을 넘기면 종료일은 다음 해
    expect(parsePeriod("12월20~1월10일", "2026-12-01")).toEqual({ startDate: "2026-12-20", endDate: "2027-01-10" });
    expect(parsePeriod("2026-08-18 ~ 2026-09-17", "2026-09-05")).toEqual({ startDate: "2026-08-18", endDate: "2026-09-17" });
    expect(parsePeriod("", "2026-09-05")).toBeNull();
    expect(parsePeriod("무기한", "2026-09-05")).toBeNull();
  });

  it("실제 시트의 이름 표기: /s 소문자, /3 같은 미확인 표기, 동명이인 B, 복합 표기", () => {
    expect(splitNameSuffix("조민수/s")).toEqual({ name: "조민수", short: true, tag: null });
    expect(splitNameSuffix("장지아/3")).toEqual({ name: "장지아", short: false, tag: "/3" });
    expect(splitNameSuffix("오세훈/n")).toEqual({ name: "오세훈", short: false, tag: "/n" });
    expect(splitNameSuffix("김지민B")).toEqual({ name: "김지민B", short: false, tag: null });
    expect(splitNameSuffix("박민서B/S")).toEqual({ name: "박민서B", short: true, tag: null });
    expect(splitNameSuffix("장은진/,S")).toEqual({ name: "장은진", short: true, tag: null });
    expect(splitNameSuffix("이현우/")).toEqual({ name: "이현우", short: false, tag: null });
  });

  it("좌석번호 칸의 상태 낱말", () => {
    expect(statusFromToken("상담")).toBe("prospect");
    expect(statusFromToken("종료")).toBe("withdrawn");
    expect(statusFromToken("휴원")).toBe("paused");
    expect(statusFromToken("등록")).toBe("enrolled");
    expect(statusFromToken("12")).toBeNull();
    expect(statusFromToken("")).toBeNull();
  });
});
