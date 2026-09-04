import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { LocalStorage } from "@/lib/storage";
import { getMemberFile, listMemberFiles, saveMemberFile } from "@/modules/files/repo";
import { createMember } from "@/modules/members/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

const storage = new LocalStorage(mkdtempSync(join(tmpdir(), "byeolha-files-")));
const pdf = Buffer.from("%PDF-1.4 test");

describe("회원 파일", () => {
  beforeEach(resetDb);

  it("업로드·목록·다운로드, 같은 종류·제목은 버전이 올라간다", async () => {
    const t = await seedTwoBranches();
    const m = await createMember(t.mgrCtx1, { name: "가", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false });
    const id1 = await saveMemberFile(t.mgrCtx1, { memberId: m, kind: "ai_report", title: "9월 AI 컨설팅 리포트", fileName: "report.pdf", mimeType: "application/pdf", data: pdf }, storage);
    const id2 = await saveMemberFile(t.mgrCtx1, { memberId: m, kind: "ai_report", title: "9월 AI 컨설팅 리포트", fileName: "report-v2.pdf", mimeType: "application/pdf", data: pdf }, storage);
    const list = await listMemberFiles(t.mgrCtx1, m);
    expect(list.map((f) => [f.id, f.version])).toEqual([
      [id2, 2],
      [id1, 1],
    ]);
    const f = await getMemberFile(t.mgrCtx1, id2, storage);
    expect(f.meta.fileName).toBe("report-v2.pdf");
    expect(f.data.toString()).toBe("%PDF-1.4 test");
    await expect(getMemberFile(t.mgrCtx2, id2, storage)).rejects.toThrow(NotFoundError);
    await expect(getMemberFile(t.asstCtx1, id2, storage)).rejects.toThrow(ForbiddenError);
  });

  it("허용되지 않은 형식·크기는 거부한다", async () => {
    const t = await seedTwoBranches();
    const m = await createMember(t.mgrCtx1, { name: "가", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false });
    await expect(saveMemberFile(t.mgrCtx1, { memberId: m, kind: "other", title: "x", fileName: "x.exe", mimeType: "application/x-msdownload", data: pdf }, storage)).rejects.toThrow(ValidationError);
    await expect(saveMemberFile(t.mgrCtx1, { memberId: m, kind: "other", title: "x", fileName: "big.pdf", mimeType: "application/pdf", data: Buffer.alloc(21 * 1024 * 1024) }, storage)).rejects.toThrow(/20MB/);
    await expect(saveMemberFile(t.mentorCtx1, { memberId: m, kind: "other", title: "x", fileName: "x.pdf", mimeType: "application/pdf", data: pdf }, storage)).resolves.toBeDefined();
    await expect(saveMemberFile(t.asstCtx1, { memberId: m, kind: "other", title: "x", fileName: "x.pdf", mimeType: "application/pdf", data: pdf }, storage)).rejects.toThrow(ForbiddenError);
  });
});
