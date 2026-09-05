import { describe, expect, it } from "vitest";
import { NhnCloudProvider, SolapiProvider } from "@/modules/alimtalk/provider";

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

describe("NhnCloudProvider", () => {
  it("appKey 경로·X-Secret-Key 헤더·recipientList 형식으로 보내고 requestId 를 돌려준다", async () => {
    const { f, calls } = fakeFetch(200, { header: { isSuccessful: true, resultCode: 0, resultMessage: "SUCCESS" }, message: { requestId: "req-1" } });
    const p = new NhnCloudProvider({ appKey: "APP", secretKey: "SEC", senderKey: "SENDER" }, f);
    const r = await p.send({ to: "010-1111-2222", text: "본문", templateCode: "WEEKLY", variables: { 이름: "가나" } });
    expect(r).toEqual({ ok: true, providerMessageId: "req-1" });
    expect(calls[0].url).toBe("https://api-alimtalk.cloud.toast.com/alimtalk/v2.3/appkeys/APP/messages");
    expect((calls[0].init.headers as Record<string, string>)["X-Secret-Key"]).toBe("SEC");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ senderKey: "SENDER", templateCode: "WEEKLY", recipientList: [{ recipientNo: "01011112222", templateParameter: { 이름: "가나" } }] });
  });
  it("isSuccessful=false 면 실패 사유를 돌려준다", async () => {
    const { f } = fakeFetch(200, { header: { isSuccessful: false, resultCode: 4000, resultMessage: "Invalid template" } });
    const p = new NhnCloudProvider({ appKey: "APP", secretKey: "SEC", senderKey: "SENDER" }, f);
    expect(await p.send({ to: "01011112222", text: "x", templateCode: "T", variables: {} })).toEqual({ ok: false, error: "Invalid template (4000)" });
  });
});

describe("SolapiProvider", () => {
  it("HMAC 인증 헤더와 kakaoOptions(변수는 #{키}) 형식으로 보낸다", async () => {
    const { f, calls } = fakeFetch(200, { groupId: "G1", messageId: "M1", statusCode: "2000" });
    const p = new SolapiProvider({ apiKey: "KEY", apiSecret: "SECRET", pfId: "PF", from: "0311234567" }, f);
    const r = await p.send({ to: "010-1111-2222", text: "본문", templateCode: "TPL1", variables: { 이름: "가나", 링크: "u" } });
    expect(r).toEqual({ ok: true, providerMessageId: "M1" });
    expect(calls[0].url).toBe("https://api.solapi.com/messages/v4/send");
    const auth = (calls[0].init.headers as Record<string, string>).Authorization;
    expect(auth).toMatch(/^HMAC-SHA256 apiKey=KEY, date=.+, salt=.+, signature=[0-9a-f]{64}$/);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      message: { to: "01011112222", from: "0311234567", text: "본문", kakaoOptions: { pfId: "PF", templateId: "TPL1", variables: { "#{이름}": "가나", "#{링크}": "u" } } },
    });
  });
  it("HTTP 오류는 errorMessage 를 돌려준다", async () => {
    const { f } = fakeFetch(400, { errorCode: "ValidationError", errorMessage: "to is required" });
    const p = new SolapiProvider({ apiKey: "KEY", apiSecret: "SECRET", pfId: "PF", from: "0311234567" }, f);
    expect(await p.send({ to: "", text: "x", templateCode: "T", variables: {} })).toEqual({ ok: false, error: "to is required" });
  });
});
