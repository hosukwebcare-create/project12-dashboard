import { describe, expect, it } from "vitest";
import { extractVariables, renderTemplate } from "@/lib/rules/template";

describe("renderTemplate", () => {
  it("#{변수}를 치환한다", () => {
    expect(renderTemplate("#{이름}님, #{지점} 주간리포트가 도착했습니다.", { 이름: "홍길동", 지점: "동탄2" })).toBe("홍길동님, 동탄2 주간리포트가 도착했습니다.");
  });
  it("값이 없는 변수는 빈 문자열", () => {
    expect(renderTemplate("#{이름}님 #{없음}", { 이름: "홍" })).toBe("홍님 ");
  });
});

describe("extractVariables", () => {
  it("본문의 변수를 순서대로 중복 없이", () => {
    expect(extractVariables("#{이름}님 #{지점} #{이름}")).toEqual(["이름", "지점"]);
    expect(extractVariables("변수 없음")).toEqual([]);
  });
});
