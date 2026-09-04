import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { MockProvider } from "@/modules/alimtalk/provider";
import { buildRecipients, listMessages, listTemplates, processQueue, queueMessages, upsertTemplate } from "@/modules/alimtalk/repo";
import { createMember } from "@/modules/members/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

async function seedAlimtalk() {
  const t = await seedTwoBranches();
  const a = await createMember(t.mgrCtx1, { name: "가나", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: true, phone: "010-1111-2222", guardian: { name: "가보호자", relation: "모", phone: "010-3333-4444" } });
  const b = await createMember(t.mgrCtx1, { name: "다라", status: "enrolled", seatId: t.seats1[1].id, memberKind: "student", focusCare: false, phone: null });
  const c = await createMember(t.mgrCtx2, { name: "타지점", status: "enrolled", seatId: t.seats2[0].id, memberKind: "student", focusCare: true, phone: "010-9999-0000" });
  const tplId = await upsertTemplate(t.hqCtx1, { code: "WEEKLY_REPORT", name: "주간리포트 안내", body: "#{이름}님, #{지점} 주간리포트가 도착했습니다. #{링크}", active: true });
  return { ...t, a, b, c, tplId };
}

describe("알림톡 템플릿", () => {
  beforeEach(resetDb);

  it("본사만 템플릿을 만들고 변수는 자동 추출된다", async () => {
    const t = await seedAlimtalk();
    const list = await listTemplates(t.mgrCtx1);
    expect(list.map((x) => [x.code, x.variables])).toEqual([["WEEKLY_REPORT", ["이름", "지점", "링크"]]]);
    await expect(upsertTemplate(t.mgrCtx1, { code: "X", name: "x", body: "x", active: true })).rejects.toThrow(ForbiddenError);
    await expect(upsertTemplate(t.hqCtx1, { code: "WEEKLY_REPORT", name: "중복", body: "x", active: true })).rejects.toThrow(ValidationError);
  });
});

describe("수신자 구성과 발송 큐", () => {
  beforeEach(resetDb);

  it("대상 그룹과 수신자 유형에 따라 번호를 고른다", async () => {
    const t = await seedAlimtalk();
    const all = await buildRecipients(t.mgrCtx1, { group: "all", recipientType: "member" });
    expect(all.map((r) => [r.name, r.phone])).toEqual([
      ["가나", "010-1111-2222"],
      ["다라", null],
    ]);
    const focusGuardian = await buildRecipients(t.mgrCtx1, { group: "focus", recipientType: "guardian" });
    expect(focusGuardian.map((r) => [r.name, r.phone, r.recipientName])).toEqual([["가나", "010-3333-4444", "가보호자"]]);
    const picked = await buildRecipients(t.mgrCtx1, { group: "members", memberIds: [t.b, t.c], recipientType: "member" });
    expect(picked.map((r) => r.name)).toEqual(["다라"]); // 타 지점 회원은 제외
  });

  it("큐에 넣으면 본문이 렌더링되고 번호 없는 회원은 건너뛴다", async () => {
    const t = await seedAlimtalk();
    const recipients = await buildRecipients(t.mgrCtx1, { group: "all", recipientType: "member" });
    const r = await queueMessages(t.mgrCtx1, { templateId: t.tplId, recipients, extraVars: { 링크: "https://example.com/r/1" } });
    expect(r).toMatchObject({ queued: 1, skipped: 1 });
    const msgs = await listMessages(t.mgrCtx1);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ recipientPhone: "010-1111-2222", status: "queued", renderedText: "가나님, 지점1 주간리포트가 도착했습니다. https://example.com/r/1" });
    expect(await listMessages(t.mgrCtx2)).toEqual([]);
    await expect(queueMessages(t.asstCtx1, { templateId: t.tplId, recipients, extraVars: {} })).rejects.toThrow(ForbiddenError);
  });

  it("발송 처리는 공급자 결과에 따라 sent/failed 로 바뀐다", async () => {
    const t = await seedAlimtalk();
    await createMember(t.mgrCtx1, { name: "실패", status: "enrolled", seatId: t.seats1[2].id, memberKind: "student", focusCare: false, phone: "010-0000-9999" });
    const recipients = await buildRecipients(t.mgrCtx1, { group: "all", recipientType: "member" });
    await queueMessages(t.mgrCtx1, { templateId: t.tplId, recipients, extraVars: { 링크: "x" } });
    const provider = new MockProvider({ failWhen: (to) => to === "010-0000-9999" });
    const res = await processQueue(provider, 10);
    expect(res).toEqual({ sent: 1, failed: 1 });
    const msgs = await listMessages(t.mgrCtx1);
    expect(msgs.map((m) => [m.recipientPhone, m.status]).sort()).toEqual([
      ["010-0000-9999", "failed"],
      ["010-1111-2222", "sent"],
    ]);
    expect(provider.sent.map((s) => s.to)).toEqual(["010-1111-2222"]);
    // 다시 처리해도 이미 보낸 건은 재발송하지 않는다
    expect(await processQueue(provider, 10)).toEqual({ sent: 0, failed: 0 });
  });
});
