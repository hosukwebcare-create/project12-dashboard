import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { members } from "@/db/schema";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { createMember, getMember, updateMember } from "@/modules/members/repo";
import { customFieldsFor, listCustomFieldDefs, upsertCustomFieldDef } from "@/modules/settings/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

describe("커스텀 필드 정의", () => {
  beforeEach(resetDb);

  it("본사 관리자만 정의를 만들 수 있다", async () => {
    const t = await seedTwoBranches();
    await expect(upsertCustomFieldDef(t.mgrCtx1, { entity: "member", key: "x", label: "X", type: "text", options: [], required: false, sort: 1, active: true })).rejects.toThrow(ForbiddenError);
    const id = await upsertCustomFieldDef(t.hqCtx1, { entity: "member", key: "cram_school", label: "학원", type: "select", options: ["A학원", "B학원"], required: false, sort: 2, active: true });
    await upsertCustomFieldDef(t.hqCtx1, { entity: "member", key: "target_score", label: "목표 점수", type: "number", options: [], required: true, sort: 1, active: true });
    await upsertCustomFieldDef(t.hqCtx1, { entity: "member", key: "old", label: "옛 필드", type: "text", options: [], required: false, sort: 3, active: false });
    const defs = await customFieldsFor(t.mgrCtx1, "member");
    expect(defs.map((d) => d.key)).toEqual(["target_score", "cram_school"]);
    expect((await listCustomFieldDefs(t.hqCtx1)).map((d) => d.key)).toEqual(["target_score", "cram_school", "old"]);
    // 수정
    await upsertCustomFieldDef(t.hqCtx1, { id, entity: "member", key: "cram_school", label: "다니는 학원", type: "select", options: ["A학원", "B학원", "C학원"], required: false, sort: 2, active: true });
    expect((await customFieldsFor(t.mgrCtx1, "member")).find((d) => d.key === "cram_school")?.label).toBe("다니는 학원");
  });

  it("키 형식·선택지 검증", async () => {
    const t = await seedTwoBranches();
    await expect(upsertCustomFieldDef(t.hqCtx1, { entity: "member", key: "한글키", label: "x", type: "text", options: [], required: false, sort: 1, active: true })).rejects.toThrow(ValidationError);
    await expect(upsertCustomFieldDef(t.hqCtx1, { entity: "member", key: "sel", label: "x", type: "select", options: [], required: false, sort: 1, active: true })).rejects.toThrow(/선택지/);
    await expect(upsertCustomFieldDef(t.hqCtx1, { entity: "member", key: "name", label: "x", type: "text", options: [], required: false, sort: 1, active: true })).rejects.toThrow(/예약/);
  });
});

describe("회원 커스텀 값", () => {
  beforeEach(resetDb);

  it("정의에 맞춰 저장·검증되고 수정 시 병합된다", async () => {
    const t = await seedTwoBranches();
    await upsertCustomFieldDef(t.hqCtx1, { entity: "member", key: "cram_school", label: "학원", type: "select", options: ["A학원", "B학원"], required: false, sort: 1, active: true });
    await upsertCustomFieldDef(t.hqCtx1, { entity: "member", key: "target_score", label: "목표 점수", type: "number", options: [], required: true, sort: 2, active: true });

    await expect(createMember(t.mgrCtx1, { name: "홍길동", status: "prospect", memberKind: "student", focusCare: false, custom: { cram_school: "A학원" } })).rejects.toThrow(/목표 점수/);
    const id = await createMember(t.mgrCtx1, { name: "홍길동", status: "prospect", memberKind: "student", focusCare: false, custom: { cram_school: "A학원", target_score: "88" } });
    expect((await getMember(t.mgrCtx1, id)).custom).toEqual({ cram_school: "A학원", target_score: 88 });

    await updateMember(t.mgrCtx1, id, { name: "홍길동", status: "prospect", memberKind: "student", focusCare: false, custom: { target_score: 95, cram_school: "" } });
    const [row] = await db.select().from(members).where(eq(members.id, id));
    expect(row.custom).toEqual({ cram_school: null, target_score: 95 });
  });

  it("정의가 없으면 custom은 빈 객체", async () => {
    const t = await seedTwoBranches();
    const id = await createMember(t.mgrCtx1, { name: "홍길동", status: "prospect", memberKind: "student", focusCare: false, custom: { anything: "x" } });
    expect((await getMember(t.mgrCtx1, id)).custom).toEqual({});
  });
});
