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

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * NHN Cloud Notification 알림톡 (v2.3). 필드명은 딜러 공식 문서 기준으로 확인한다.
 * POST https://api-alimtalk.cloud.toast.com/alimtalk/v2.3/appkeys/{appKey}/messages
 */
export class NhnCloudProvider implements AlimtalkProvider {
  readonly name = "nhn";
  constructor(
    private cfg: { appKey: string; secretKey: string; senderKey: string; baseUrl?: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async send(input: SendInput): Promise<SendResult> {
    const base = this.cfg.baseUrl ?? "https://api-alimtalk.cloud.toast.com";
    try {
      const res = await this.fetchImpl(`${base}/alimtalk/v2.3/appkeys/${this.cfg.appKey}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=UTF-8", "X-Secret-Key": this.cfg.secretKey },
        body: JSON.stringify({ senderKey: this.cfg.senderKey, templateCode: input.templateCode, recipientList: [{ recipientNo: digits(input.to), templateParameter: input.variables }] }),
      });
      const data = (await res.json().catch(() => ({}))) as { header?: { isSuccessful?: boolean; resultCode?: number; resultMessage?: string }; message?: { requestId?: string } };
      if (!res.ok || !data.header?.isSuccessful) return { ok: false, error: `${data.header?.resultMessage ?? `HTTP ${res.status}`}${data.header?.resultCode !== undefined ? ` (${data.header.resultCode})` : ""}` };
      return { ok: true, providerMessageId: data.message?.requestId ?? `nhn-${Date.now()}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "네트워크 오류" };
    }
  }
}

/**
 * 솔라피(Solapi) 카카오 알림톡. HMAC-SHA256 인증. 변수 키는 "#{이름}" 형식.
 * POST https://api.solapi.com/messages/v4/send
 */
export class SolapiProvider implements AlimtalkProvider {
  readonly name = "solapi";
  constructor(
    private cfg: { apiKey: string; apiSecret: string; pfId: string; from: string; baseUrl?: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}
  private async authHeader(): Promise<string> {
    const { createHmac, randomBytes } = await import("node:crypto");
    const date = new Date().toISOString();
    const salt = randomBytes(16).toString("hex");
    const signature = createHmac("sha256", this.cfg.apiSecret).update(date + salt).digest("hex");
    return `HMAC-SHA256 apiKey=${this.cfg.apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  }
  async send(input: SendInput): Promise<SendResult> {
    const base = this.cfg.baseUrl ?? "https://api.solapi.com";
    const variables: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.variables)) variables[`#{${k}}`] = v;
    try {
      const res = await this.fetchImpl(`${base}/messages/v4/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: await this.authHeader() },
        body: JSON.stringify({ message: { to: digits(input.to), from: digits(this.cfg.from), text: input.text, kakaoOptions: { pfId: this.cfg.pfId, templateId: input.templateCode, variables } } }),
      });
      const data = (await res.json().catch(() => ({}))) as { messageId?: string; groupId?: string; errorMessage?: string; errorCode?: string };
      if (!res.ok) return { ok: false, error: data.errorMessage ?? data.errorCode ?? `HTTP ${res.status}` };
      return { ok: true, providerMessageId: data.messageId ?? data.groupId ?? `solapi-${Date.now()}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "네트워크 오류" };
    }
  }
}

let cached: AlimtalkProvider | null = null;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경 변수가 필요합니다`);
  return v;
}

export function getProvider(): AlimtalkProvider {
  if (cached) return cached;
  const kind = process.env.ALIMTALK_PROVIDER ?? "mock";
  switch (kind) {
    case "http":
      cached = new HttpProvider(need("ALIMTALK_ENDPOINT"), need("ALIMTALK_API_KEY"), process.env.ALIMTALK_SENDER_KEY ?? null);
      break;
    case "nhn":
      cached = new NhnCloudProvider({ appKey: need("ALIMTALK_NHN_APP_KEY"), secretKey: need("ALIMTALK_NHN_SECRET_KEY"), senderKey: need("ALIMTALK_SENDER_KEY") });
      break;
    case "solapi":
      cached = new SolapiProvider({ apiKey: need("ALIMTALK_SOLAPI_API_KEY"), apiSecret: need("ALIMTALK_SOLAPI_API_SECRET"), pfId: need("ALIMTALK_SOLAPI_PF_ID"), from: need("ALIMTALK_SOLAPI_FROM") });
      break;
    default:
      cached = new MockProvider();
  }
  return cached;
}
