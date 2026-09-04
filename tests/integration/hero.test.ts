import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ingestHeroResult, listHeroLinks, verifyHeroSignature } from "@/modules/hero/repo";
import { createMember } from "@/modules/members/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

describe("HERO 학습진단 연동", () => {
  beforeEach(resetDb);

  it("서명 검증", () => {
    const body = JSON.stringify({ a: 1 });
    const sig = createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyHeroSignature(body, sig, "secret")).toBe(true);
    expect(verifyHeroSignature(body, "bad", "secret")).toBe(false);
    expect(verifyHeroSignature(body, sig, "other")).toBe(false);
  });

  it("지점 코드와 연락처로 회원을 찾아 결과를 연결하고, 같은 externalId는 갱신한다", async () => {
    const t = await seedTwoBranches();
    const m = await createMember(t.mgrCtx1, { name: "가나", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false, phone: "010-1111-2222" });
    const r1 = await ingestHeroResult({ branchCode: "B1", memberPhone: "01011112222", externalId: "hero-1", summary: { type: "탐구형", score: 82 }, resultUrl: "https://hero.example/r/1", takenAt: "2026-09-01T10:00:00+09:00" });
    expect(r1).toEqual({ memberId: m, created: true });
    const r2 = await ingestHeroResult({ branchCode: "B1", memberPhone: "010-1111-2222", externalId: "hero-1", summary: { type: "탐구형", score: 85 }, resultUrl: null, takenAt: null });
    expect(r2).toEqual({ memberId: m, created: false });
    const links = await listHeroLinks(t.mgrCtx1, m);
    expect(links).toHaveLength(1);
    expect(links[0].summary).toEqual({ type: "탐구형", score: 85 });
  });

  it("이름+좌석으로도 찾고, 못 찾으면 오류", async () => {
    const t = await seedTwoBranches();
    const m = await createMember(t.mgrCtx1, { name: "다라", status: "enrolled", seatId: t.seats1[2].id, memberKind: "student", focusCare: false });
    const r = await ingestHeroResult({ branchCode: "B1", memberName: "다라", seatNo: 3, externalId: "hero-2", summary: {}, resultUrl: null, takenAt: null });
    expect(r.memberId).toBe(m);
    await expect(ingestHeroResult({ branchCode: "B1", memberName: "없음", seatNo: 9, externalId: "hero-3", summary: {}, resultUrl: null, takenAt: null })).rejects.toThrow(ValidationError);
    await expect(ingestHeroResult({ branchCode: "NOPE", memberName: "다라", seatNo: 3, externalId: "hero-4", summary: {}, resultUrl: null, takenAt: null })).rejects.toThrow(NotFoundError);
  });
});
