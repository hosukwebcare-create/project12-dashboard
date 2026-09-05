import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { eventOutbox } from "@/db/schema";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { createIssue } from "@/modules/issues/repo";
import { createMember } from "@/modules/members/repo";
import { dispatchOutbox, listWebhookEndpoints, upsertWebhookEndpoint } from "@/modules/outbox/repo";
import { startSession, upsertCheck } from "@/modules/rounding/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

describe("메신저 웹훅 아웃박스", () => {
  beforeEach(resetDb);

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
