/**
 * 메신저 웹훅 전송 형식. 주소만 보고 메신저를 알아내서, 설정 화면에서 형식을 따로 고르게 하지 않는다.
 * - slack: Slack·Mattermost·Rocket.Chat 인커밍 웹훅이 받는 { text } JSON
 * - jandi: 잔디 커넥트 인커밍 웹훅. { body, connectColor, connectInfo } 와 전용 Accept 헤더가 있어야 받는다
 *   (https://support.jandi.com/ko/articles/21bc249f — 본문 5,000자, 분당 60건)
 */
export type WebhookFormat = "slack" | "jandi";

export const JANDI_WEBHOOK_HOST = "wh.jandi.com";
/** 잔디가 한 메시지에 보여 주는 최대 글자 수 */
export const JANDI_BODY_MAX = 5000;

export function webhookFormat(url: string): WebhookFormat {
  try {
    return new URL(url).hostname.toLowerCase() === JANDI_WEBHOOK_HOST ? "jandi" : "slack";
  } catch {
    return "slack";
  }
}

export type OutboxLike = { type: string; text: string; payload: Record<string, unknown> };
export type WebhookRequest = { body: string; headers: Record<string, string> };

/** 잔디 메시지 아래 색 띠. 급한 것일수록 붉다 */
const JANDI_COLOR: Record<string, string> = {
  "issue.created": "#E0115F",
  "penalty.high": "#F26B1D",
  "session.completed": "#2E9E5B",
  "handover.request": "#006CD6",
  "handover.notice": "#6B7280",
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** 잔디 첨부 영역(connectInfo)에 넣을 항목. 메시지 본문(text)에 이미 다 있는 내용은 빼고, 눌러서 볼 만한 것만 */
function jandiInfo(ev: OutboxLike): { title: string; description: string }[] {
  const p = ev.payload;
  const out: { title: string; description: string }[] = [];
  const add = (title: string, v: unknown) => {
    const d = str(v);
    if (d) out.push({ title, description: d.slice(0, 1000) });
  };
  switch (ev.type) {
    case "issue.created":
      add("보고", p.reportedBy);
      add("긴급도", p.severity === "high" ? "긴급" : p.severity === "low" ? "낮음" : "보통");
      break;
    case "penalty.high":
      add("어디서", [p.date, p.where].filter(Boolean).join(" "));
      add("규칙", p.rule);
      break;
    case "session.completed":
      add("벌점", p.penalties !== undefined ? `${p.penalties}건 ${p.points ?? 0}점` : null);
      add("이슈 · 부재", p.issues !== undefined ? `이슈 ${p.issues}건 · 부재 ${p.absent}명` : null);
      add("입력", p.completedBy);
      break;
    case "handover.request":
    case "handover.notice":
      add("내용", p.body);
      add("쓴 사람", p.author);
      break;
  }
  return out;
}

/** 아웃박스 이벤트 하나를 그 메신저가 받는 요청 본문과 헤더로 바꾼다 */
export function buildWebhookRequest(format: WebhookFormat, ev: OutboxLike): WebhookRequest {
  if (format === "jandi") {
    return {
      body: JSON.stringify({ body: ev.text.slice(0, JANDI_BODY_MAX), connectColor: JANDI_COLOR[ev.type] ?? "#006CD6", connectInfo: jandiInfo(ev) }),
      headers: { Accept: "application/vnd.tosslab.jandi-v2+json", "Content-Type": "application/json" },
    };
  }
  return { body: JSON.stringify({ text: ev.text, event: ev.type, ...ev.payload }), headers: { "Content-Type": "application/json" } };
}

/**
 * 잔디 아웃고잉 웹훅이 보내는 글에서 부탁 내용만 꺼낸다. `data` 는 키워드를 뺀 본문이고(새 형식),
 * 없으면 `text` 앞의 키워드(/해주세요 등)를 지운다. 글쓴이 이름은 writer.name(새 형식) 또는 writerName(예전 형식).
 */
export function parseJandiOutgoing(p: Record<string, unknown>): { text: string; writerName: string | null } {
  const keyword = str(p.keyword);
  let text = str(p.data) ?? str(p.text) ?? "";
  if (!str(p.data) && keyword) text = text.replace(new RegExp(`^\\s*/?${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`), "");
  const writer = p.writer && typeof p.writer === "object" ? (p.writer as Record<string, unknown>) : null;
  return { text: text.trim(), writerName: str(writer?.name) ?? str(p.writerName) };
}
