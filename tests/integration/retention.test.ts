import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { memberFiles, memberGuardians, members } from "@/db/schema";
import { LocalStorage } from "@/lib/storage";
import { saveMemberFile } from "@/modules/files/repo";
import { changeStatus, createMember, getMember } from "@/modules/members/repo";
import { anonymizeWithdrawnMembers } from "@/modules/retention/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

const storage = new LocalStorage(mkdtempSync(join(tmpdir(), "byeolha-ret-")));

describe("개인정보 보관기간 · 퇴원 회원 익명화", () => {
  beforeEach(resetDb);

  it("퇴원 후 보관기간이 지난 회원만 익명화하고 학부모·파일을 지운다", async () => {
    const t = await seedTwoBranches();
    const old = await createMember(t.mgrCtx1, { name: "옛회원", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false, phone: "010-1111-2222", address: "주소", guardian: { name: "보호자", relation: "모", phone: "010-3333-4444" } });
    const recent = await createMember(t.mgrCtx1, { name: "최근퇴원", status: "enrolled", seatId: t.seats1[1].id, memberKind: "student", focusCare: false, phone: "010-5555-6666" });
    const active = await createMember(t.mgrCtx1, { name: "재원", status: "enrolled", seatId: t.seats1[2].id, memberKind: "student", focusCare: false, phone: "010-7777-8888" });
    await saveMemberFile(t.mgrCtx1, { memberId: old, kind: "ai_report", title: "리포트", fileName: "r.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF") }, storage);

    await changeStatus(t.mgrCtx1, old, "withdrawn");
    await changeStatus(t.mgrCtx1, recent, "withdrawn");
    // 퇴원일을 400일 전으로 되돌린다
    await db.update(members).set({ withdrawnAt: "2025-07-01" }).where(eq(members.id, old));
    expect((await db.select().from(members).where(eq(members.id, recent)))[0].withdrawnAt).toBeTruthy();

    const r = await anonymizeWithdrawnMembers({ retentionDays: 365, now: new Date(2026, 8, 5) }, storage);
    expect(r).toEqual({ anonymized: 1, filesDeleted: 1 });

    const [o] = await db.select().from(members).where(eq(members.id, old));
    expect(o.name).toMatch(/^탈퇴회원-/);
    expect(o.phone).toBeNull();
    expect(o.address).toBeNull();
    expect(o.anonymizedAt).not.toBeNull();
    expect(await db.select().from(memberGuardians).where(eq(memberGuardians.memberId, old))).toEqual([]);
    expect(await db.select().from(memberFiles).where(eq(memberFiles.memberId, old))).toEqual([]);

    const rec = await getMember(t.mgrCtx1, recent);
    expect(rec.name).toBe("최근퇴원");
    expect(rec.phone).toBe("010-5555-6666");
    const act = await getMember(t.mgrCtx1, active);
    expect(act.phone).toBe("010-7777-8888");

    // 다시 실행해도 중복 처리하지 않는다
    expect(await anonymizeWithdrawnMembers({ retentionDays: 365, now: new Date(2026, 8, 5) }, storage)).toEqual({ anonymized: 0, filesDeleted: 0 });
  });

  it("퇴원 처리 시 withdrawnAt 이 기록되고 재등록하면 지워진다", async () => {
    const t = await seedTwoBranches();
    const id = await createMember(t.mgrCtx1, { name: "가", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false });
    await changeStatus(t.mgrCtx1, id, "withdrawn");
    expect((await db.select().from(members).where(eq(members.id, id)))[0].withdrawnAt).toBeTruthy();
    await changeStatus(t.mgrCtx1, id, "enrolled");
    expect((await db.select().from(members).where(eq(members.id, id)))[0].withdrawnAt).toBeNull();
  });
});
