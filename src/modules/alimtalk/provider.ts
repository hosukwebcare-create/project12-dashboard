/**
 * 알림톡 발송 어댑터.
 * - MockProvider: 개발·테스트용. 실제 발송 없이 성공/실패를 흉내낸다.
 * - HttpProvider: 공식 딜러사(NHN Cloud, 솔라피 등)의 REST API 앞단에 두는 범용 어댑터.
 *   ALIMTALK_ENDPOINT 로 JSON POST 하며, 딜러별 요청 형식이 다르면 이 파일의 toRequest/parseResponse 만 바꾼다.
 */
export type SendInput = { to: string; text: string; templateCode: string | null; variables: Record<string, string> };
export type SendResult = { ok: true; providerMessageId: string } | { ok: false; error: string };

export interface AlimtalkProvider {
  readonly name: string;
  send(input: SendInput): Promise<SendResult>;
}

export class MockProvider implements AlimtalkProvider {
  readonly name = "mock";
  readonly sent: SendInput[] = [];
  private failWhen: (to: string) => boolean;
  constructor(opts: { failWhen?: (to: string) => boolean } = {}) {
    this.failWhen = opts.failWhen ?? (() => false);
  }
  async send(input: SendInput): Promise<SendResult> {
    if (this.failWhen(input.to)) return { ok: false, error: "수신 불가 번호 (mock)" };
    this.sent.push(input);
    return { ok: true, providerMessageId: `mock-${this.sent.length}-${Date.now()}` };
  }
}

export class HttpProvider implements AlimtalkProvider {
  readonly name = "http";
  constructor(
    private endpoint: string,
    private apiKey: string,
    private senderKey: string | null,
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async send(input: SendInput): Promise<SendResult> {
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          senderKey: this.senderKey,
          templateCode: input.templateCode,
          recipientNo: input.to.replace(/\D/g, ""),
          content: input.text,
          templateParameter: input.variables,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { messageId?: string; id?: string; message?: string; error?: string };
      if (!res.ok) return { ok: false, error: data.message ?? data.error ?? `HTTP ${res.status}` };
      return { ok: true, providerMessageId: data.messageId ?? data.id ?? `http-${Date.now()}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "네트워크 오류" };
    }
  }
}

let cached: AlimtalkProvider | null = null;

export function getProvider(): AlimtalkProvider {
  if (cached) return cached;
  const kind = process.env.ALIMTALK_PROVIDER ?? "mock";
  if (kind === "http") {
    const endpoint = process.env.ALIMTALK_ENDPOINT;
    const apiKey = process.env.ALIMTALK_API_KEY;
    if (!endpoint || !apiKey) throw new Error("ALIMTALK_ENDPOINT / ALIMTALK_API_KEY 환경 변수가 필요합니다");
    cached = new HttpProvider(endpoint, apiKey, process.env.ALIMTALK_SENDER_KEY ?? null);
  } else {
    cached = new MockProvider();
  }
  return cached;
}
