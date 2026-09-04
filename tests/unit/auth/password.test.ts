import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("비밀번호 해시", () => {
  it("해시는 원문과 다르고 검증에 성공한다", async () => {
    const hash = await hashPassword("1234");
    expect(hash).not.toBe("1234");
    expect(await verifyPassword("1234", hash)).toBe(true);
  });
  it("틀린 비밀번호는 실패한다", async () => {
    const hash = await hashPassword("1234");
    expect(await verifyPassword("4321", hash)).toBe(false);
  });
  it("같은 비밀번호도 해시가 매번 다르다(솔트)", async () => {
    expect(await hashPassword("1234")).not.toBe(await hashPassword("1234"));
  });
});
