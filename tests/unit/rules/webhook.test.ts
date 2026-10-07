import { describe, expect, it } from "vitest";
import { buildWebhookRequest, JANDI_BODY_MAX, parseJandiOutgoing, webhookFormat } from "@/lib/rules/webhook";

describe("메신저 웹훅 형식", () => {
  it("잔디 주소(wh.jandi.com)만 잔디 형식, 나머지는 슬랙 형식", () => {
    expect(webhookFormat("https://wh.jandi.com/connect-api/webhook/123/abc")).toBe("jandi");
    expect(webhookFormat("https://WH.JANDI.COM/connect-api/webhook/123/abc")).toBe("jandi");
    expect(webhookFormat("https://hooks.slack.com/services/T/B/x")).toBe("slack");
    expect(webhookFormat("https://chat.example.com/hooks/abc")).toBe("slack");
    expect(webhookFormat("not a url")).toBe("slack");
  });

  it("슬랙 형식은 예전 그대로 { text, event, …payload }", () => {
    const req = buildWebhookRequest("slack", { type: "issue.created", text: "[이슈 보고] x", payload: { issueId: "i1" } });
    expect(JSON.parse(req.body)).toEqual({ text: "[이슈 보고] x", event: "issue.created", issueId: "i1" });
    expect(req.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("잔디 형식은 body·connectColor·connectInfo 와 전용 Accept 헤더", () => {
    const req = buildWebhookRequest("jandi", { type: "penalty.high", text: "[고벌점] 12번 가나 · 이동금지 위반 5점 (2026-10-08 R3)", payload: { date: "2026-10-08", where: "R3", rule: "이동금지 위반", points: 5 } });
    expect(req.headers).toEqual({ Accept: "application/vnd.tosslab.jandi-v2+json", "Content-Type": "application/json" });
    const body = JSON.parse(req.body);
    expect(body.body).toBe("[고벌점] 12번 가나 · 이동금지 위반 5점 (2026-10-08 R3)");
    expect(body.connectColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(body.connectInfo).toEqual([
      { title: "어디서", description: "2026-10-08 R3" },
      { title: "규칙", description: "이동금지 위반" },
    ]);
  });

  it("잔디 본문은 5,000자에서 자른다", () => {
    const req = buildWebhookRequest("jandi", { type: "handover.notice", text: "가".repeat(6000), payload: {} });
    expect(JSON.parse(req.body).body).toHaveLength(JANDI_BODY_MAX);
  });

  it("해 주세요·공지 이벤트는 내용과 쓴 사람을 첨부에 넣는다", () => {
    const req = buildWebhookRequest("jandi", { type: "handover.request", text: "[해 주세요] 정수기 필터 (박원장)", payload: { body: "정수기 필터", author: "박원장", date: "2026-10-08" } });
    expect(JSON.parse(req.body).connectInfo).toEqual([
      { title: "내용", description: "정수기 필터" },
      { title: "쓴 사람", description: "박원장" },
    ]);
  });
});

describe("잔디 아웃고잉 웹훅 글 읽기", () => {
  it("새 형식: data 가 키워드를 뺀 본문, writer.name 이 쓴 사람", () => {
    expect(parseJandiOutgoing({ token: "t", text: "/해주세요 3층 정수기 업체에 전화", data: "3층 정수기 업체에 전화", keyword: "해주세요", writer: { name: "최조교", email: "x@y" } })).toEqual({ text: "3층 정수기 업체에 전화", writerName: "최조교" });
  });
  it("예전 형식: data 없이 text 와 writerName — 앞의 키워드를 지운다", () => {
    expect(parseJandiOutgoing({ text: "/해주세요  택배 받아 주세요", keyword: "해주세요", writerName: "정조교" })).toEqual({ text: "택배 받아 주세요", writerName: "정조교" });
    expect(parseJandiOutgoing({ text: "해주세요 택배", keyword: "해주세요" })).toEqual({ text: "택배", writerName: null });
  });
  it("내용이 없으면 빈 글", () => {
    expect(parseJandiOutgoing({ text: "/해주세요", keyword: "해주세요" }).text).toBe("");
    expect(parseJandiOutgoing({}).text).toBe("");
  });
});
