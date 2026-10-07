import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { eventOutbox } from "@/db/schema";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { createIssue } from "@/modules/issues/repo";
import { createMember } from "@/modules/members/repo";
import { dispatchOutbox, listWebhookEndpoints, upsertWebhookEndpoint } from "@/modules/outbox/repo";
import { completeSession, startSession, upsertCheck } from "@/modules/rounding/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

describe("메신저 웹훅 아웃박스", () => {
  beforeEach(resetDb);

  it("회차를 완료하면 '라운딩 회차 완료' 이벤트가 요약과 함께 쌓인다 (구독 채널이 있을 때만)", async () => {
    const t = await seedTwoBranches();
    const m = await createMember(t.mgrCtx1, { name: "가나", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false });
    // 구독 채널이 없으면 아무것도 쌓이지 않는다
    const s0 = await startSession(t.asstCtx1, "2026-09-05");
    await completeSession(t.asstCtx1, s0);
    expect(await db.select().from(eventOutbox)).toEqual([]);

    await upsertWebhookEndpoint(t.mgrCtx1, { name: "동탄 채널", url: "https://hooks.example/dt", events: ["session.completed"], active: true });
    const sid = await startSession(t.asstCtx1, "2026-09-05");
    const late = t.rules.find((r) => r.name === "지각")!;
    await upsertCheck(t.asstCtx1, { memberId: m, date: "2026-09-05", itemKey: "round", roundNo: 2, sessionId: sid, grade: "p", penaltyRuleId: late.id });
    const summary = await completeSession(t.asstCtx1, sid);

    const [ev] = await db.select().from(eventOutbox).where(eq(eventOutbox.type, "session.completed"));
    expect(ev).toBeDefined();
    expect(ev.text).toBe(`[회차 완료] 2026-09-05 R2 · ${summary.total}명 · 벌점 1건 4점 · 이슈 0건 · 부재 0명 (입력: 조교1)`);
    expect(ev.payload).toMatchObject({ sessionId: sid, roundNo: 2, penalties: 1, points: 4 });
  });

  it("지점장이 웹훅을 등록하면 이슈 생성과 고벌점이 이벤트로 쌓이고, 전송기가 보낸다", async () => {
    const t = await seedTwoBranches();
    await expect(upsertWebhookEndpoint(t.asstCtx1, { name: "x", url: "https://hooks.example/a", events: ["issue.created"], active: true })).rejects.toThrow(ForbiddenError);
    await upsertWebhookEndpoint(t.mgrCtx1, { name: "동탄 채널", url: "https://hooks.example/dt", events: ["issue.created", "penalty.high"], active: true });
    expect((await listWebhookEndpoints(t.mgrCtx1)).map((e) => e.name)).toEqual(["동탄 채널"]);
    expect(await listWebhookEndpoints(t.mgrCtx2)).toEqual([]);

    const m = await createMember(t.mgrCtx1, { name: "가나", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false });
    await createIssue(t.asstCtx1, { memberId: m, title: "가나 · 휴대폰 사용", body: "R3", severity: "normal", source: "manual" });
    const sid = await startSession(t.asstCtx1, "2026-09-05");
    const rule = t.rules.find((r) => r.name === "이동금지 위반")!; // 5점 → 고벌점
    await upsertCheck(t.asstCtx1, { memberId: m, date: "2026-09-05", itemKey: "round", roundNo: 1, sessionId: sid, grade: "p", penaltyRuleId: rule.id });
    const sleepy = t.rules.find((r) => r.name === "졸음")!; // 3점 → 이벤트 없음
    await upsertCheck(t.asstCtx1, { memberId: m, date: "2026-09-05", itemKey: "round", roundNo: 2, sessionId: sid, grade: "p", penaltyRuleId: sleepy.id });

    const pending = await db.select().from(eventOutbox).where(eq(eventOutbox.status, "pending"));
    expect(pending.map((e) => e.type).sort()).toEqual(["issue.created", "penalty.high"]);
    expect(pending.find((e) => e.type === "issue.created")?.text).toContain("가나 · 휴대폰 사용");

    const calls: { url: string; body: string }[] = [];
    const sender = async (url: string, body: string) => {
      calls.push({ url, body });
      return { ok: url.endsWith("/dt"), status: 200 };
    };
    const r = await dispatchOutbox(sender, 10);
    expect(r).toEqual({ sent: 2, failed: 0 });
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.url === "https://hooks.example/dt")).toBe(true);
    expect(JSON.parse(calls[0].body)).toHaveProperty("text");
    expect(await dispatchOutbox(sender, 10)).toEqual({ sent: 0, failed: 0 });
  });

  it("잔디 주소에는 잔디 커넥트 형식(body·connectInfo + Accept 헤더)으로, 다른 주소에는 { text } 로 보낸다", async () => {
    const t = await seedTwoBranches();
    await upsertWebhookEndpoint(t.mgrCtx1, { name: "잔디 동탄", url: "https://wh.jandi.com/connect-api/webhook/123/abc", events: ["issue.created"], active: true });
    await upsertWebhookEndpoint(t.mgrCtx1, { name: "슬랙", url: "https://hooks.example/dt", events: ["issue.created"], active: true });
    await createIssue(t.asstCtx1, { memberId: null, title: "가나 · 휴대폰 사용", body: "R3", severity: "high", source: "manual" });
    const calls: { url: string; body: string; headers?: Record<string, string> }[] = [];
    const r = await dispatchOutbox(async (url, body, headers) => {
      calls.push({ url, body, headers });
      return { ok: true, status: 200 };
    }, 10);
    expect(r).toEqual({ sent: 1, failed: 0 });
    const jandi = calls.find((c) => c.url.includes("wh.jandi.com"))!;
    expect(jandi.headers).toMatchObject({ Accept: "application/vnd.tosslab.jandi-v2+json" });
    expect(JSON.parse(jandi.body)).toMatchObject({ body: expect.stringContaining("[이슈 보고] 가나 · 휴대폰 사용"), connectInfo: [{ title: "보고", description: "조교1" }, { title: "긴급도", description: "긴급" }] });
    const slack = calls.find((c) => c.url.includes("hooks.example"))!;
    expect(JSON.parse(slack.body)).toHaveProperty("text");
    expect(JSON.parse(slack.body)).not.toHaveProperty("connectInfo");
  });

  it("'해 주세요'와 공지는 구독한 채널에 이벤트로 올라간다", async () => {
    const t = await seedTwoBranches();
    const { upsertNote } = await import("@/modules/handover/repo");
    await upsertWebhookEndpoint(t.mgrCtx1, { name: "잔디", url: "https://wh.jandi.com/connect-api/webhook/1/a", events: ["handover.request", "handover.notice"], active: true });
    await upsertNote(t.asstCtx1, { date: "2026-10-08", kind: "request", body: "3층 정수기 업체에 전화해 주세요" });
    await upsertNote(t.mgrCtx1, { date: "2026-10-08", kind: "notice", body: "내일 10시 소방 점검" });
    await upsertNote(t.asstCtx1, { date: "2026-10-08", kind: "handover", body: "일반 인수인계는 올리지 않는다" });
    const rows = await db.select().from(eventOutbox);
    expect(rows.map((r) => [r.type, r.text]).sort()).toEqual([
      ["handover.notice", "[공지] 내일 10시 소방 점검 (지점장1)"],
      ["handover.request", "[해 주세요] 3층 정수기 업체에 전화해 주세요 (조교1)"],
    ]);
  });

  it("웹훅이 없으면 이벤트를 쌓지 않는다", async () => {
    const t = await seedTwoBranches();
    await createIssue(t.asstCtx1, { memberId: null, title: "x", body: null, severity: "low", source: "manual" });
    expect(await db.select().from(eventOutbox)).toEqual([]);
  });

  it("전송 실패는 failed 로 남고 재시도 횟수가 오른다", async () => {
    const t = await seedTwoBranches();
    await upsertWebhookEndpoint(t.mgrCtx1, { name: "x", url: "https://hooks.example/bad", events: ["issue.created"], active: true });
    await createIssue(t.asstCtx1, { memberId: null, title: "x", body: null, severity: "low", source: "manual" });
    const r = await dispatchOutbox(async () => ({ ok: false, status: 500 }), 10);
    expect(r).toEqual({ sent: 0, failed: 1 });
    const [row] = await db.select().from(eventOutbox);
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("SSRF: 로컬·메타데이터·사설망 주소의 웹훅은 저장할 수 없고, 저장된 URL 은 정규화된다", async () => {
    const t = await seedTwoBranches();
    for (const url of ["http://localhost:3000/hook", "http://169.254.169.254/latest/meta-data/", "http://127.0.0.1/", "http://10.0.0.1/hook", "http://metadata.google.internal/", "https://u:p@hooks.example/x", "ftp://hooks.example/x"]) {
      await expect(upsertWebhookEndpoint(t.mgrCtx1, { name: "x", url, events: ["issue.created"], active: true }), url).rejects.toThrow(ValidationError);
    }
    await upsertWebhookEndpoint(t.mgrCtx1, { name: "ok", url: "  HTTPS://Hooks.Example/services/ABC  ", events: ["issue.created"], active: true });
    expect((await listWebhookEndpoints(t.mgrCtx1)).map((w) => w.url)).toEqual(["https://hooks.example/services/ABC"]);
  });
});
