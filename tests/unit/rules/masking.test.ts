import { describe, expect, it } from "vitest";
import { maskName, maskPhone } from "@/lib/rules/masking";

describe("maskName", () => {
  it("세 글자는 가운데를 가린다", () => {
    expect(maskName("김지민")).toBe("김*민");
  });
  it("두 글자는 끝을 가린다", () => {
    expect(maskName("이나")).toBe("이*");
  });
  it("네 글자 이상은 첫·끝만 남긴다", () => {
    expect(maskName("남궁민수")).toBe("남**수");
  });
  it("한 글자는 그대로", () => {
    expect(maskName("김")).toBe("김");
  });
});

describe("maskPhone", () => {
  it("가운데 네 자리를 가린다", () => {
    expect(maskPhone("010-5091-1066")).toBe("010-****-1066");
  });
  it("하이픈 없는 번호도 정규화한다", () => {
    expect(maskPhone("01050911066")).toBe("010-****-1066");
  });
  it("null은 null", () => {
    expect(maskPhone(null)).toBeNull();
  });
});
