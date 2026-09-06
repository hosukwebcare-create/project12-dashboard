import { describe, expect, it } from "vitest";
import { maskSensitive } from "@/lib/audit";

describe("감사 로그 개인정보 마스킹", () => {
  it("비밀번호·PIN·해시는 통째로 가린다", () => {
    expect(maskSensitive({ password: "abcd123456", pinHash: "$2a$10$xx", passwordHash: "$2a$10$yy" })).toEqual({
      password: "***",
      pinHash: "***",
      passwordHash: "***",
    });
  });

  it("연락처는 가운데만 가려 대조는 되게 남긴다", () => {
    expect(maskSensitive({ phone: "010-1234-5678", guardianPhone: "01098765432" })).toEqual({
      phone: "010-****-5678",
      guardianPhone: "010-****-5432",
    });
  });

  it("이름·상태 같은 업무 값은 그대로 둔다", () => {
    expect(maskSensitive({ name: "김민준", status: "active", seatNo: 12 })).toEqual({ name: "김민준", status: "active", seatNo: 12 });
  });

  it("중첩된 객체와 배열 안까지 적용한다", () => {
    expect(maskSensitive({ before: { guardians: [{ name: "보호자", phone: "010-1111-2222" }] } })).toEqual({
      before: { guardians: [{ name: "보호자", phone: "010-****-2222" }] },
    });
  });

  it("null·원시값은 그대로 통과한다", () => {
    expect(maskSensitive(null)).toBeNull();
    expect(maskSensitive("문자열")).toBe("문자열");
    expect(maskSensitive({ phone: null })).toEqual({ phone: null });
  });
});
