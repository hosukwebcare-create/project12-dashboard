import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-next";

describe("로그인 뒤 이동 주소 검사", () => {
  it("사이트 안의 경로는 그대로", () => {
    expect(safeNextPath("/members")).toBe("/members");
    expect(safeNextPath("/members?q=1#top")).toBe("/members?q=1#top");
  });
  it("다른 사이트로 빠지는 모양은 모두 거부", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "evil.com", "/%09/evil.com".replace("%09", "\t"), "/\nevil", " /members", "", "/" + "a".repeat(600)]) {
      expect(safeNextPath(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(safeNextPath(undefined)).toBeNull();
  });
});
