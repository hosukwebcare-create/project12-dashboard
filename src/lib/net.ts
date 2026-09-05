import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ValidationError } from "./errors";

export type IpKind = "loopback" | "link_local" | "private" | "special" | "public";

/** IP 주소의 종류를 판정한다. 호스트명이 아닌 IP 리터럴만 받는다. */
export function ipKind(ip: string): IpKind {
  const v = isIP(ip);
  if (v === 4) return v4Kind(ip);
  if (v === 6) return v6Kind(ip.toLowerCase());
  return "special";
}

function v4Kind(ip: string): IpKind {
  const [a, b] = ip.split(".").map(Number);
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link_local";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return "private";
  if (a === 0 || a >= 224) return "special";
  return "public";
}

function v6Kind(ip: string): IpKind {
  if (ip === "::1") return "loopback";
  if (ip === "::") return "special";
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Kind(mapped[1]);
  if (/^fe[89ab]/.test(ip)) return "link_local";
  if (/^f[cd]/.test(ip)) return "private";
  if (ip.startsWith("64:ff9b:")) return "special";
  return "public";
}

const BLOCKED_HOSTS = ["localhost", "metadata.google.internal", "metadata"];
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal"];

/** 사설망(RFC1918)으로의 웹훅 허용 여부. 사내 메신저를 내부망에 두는 온프레미스 구성에서 켠다 */
export function privateWebhooksAllowed(): boolean {
  return process.env.WEBHOOK_ALLOW_PRIVATE === "true";
}

function isAllowedKind(kind: IpKind): boolean {
  if (kind === "public") return true;
  if (kind === "private") return privateWebhooksAllowed();
  return false;
}

const BLOCK_MESSAGE = "웹훅 URL은 로컬·내부망·메타데이터 주소를 가리킬 수 없습니다";

/**
 * 아웃바운드 웹훅 URL 검증(동기). http/https, 자격증명 없음, 로컬·링크로컬·메타데이터 호스트 금지.
 * 사설 IP 리터럴은 WEBHOOK_ALLOW_PRIVATE=true 일 때만 허용.
 */
export function assertSafeWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ValidationError("웹훅 URL 형식이 올바르지 않습니다");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ValidationError("웹훅 URL은 http 또는 https 여야 합니다");
  if (url.username || url.password) throw new ValidationError("웹훅 URL에 아이디·비밀번호를 넣을 수 없습니다");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.includes(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    if (!(privateWebhooksAllowed() && host.endsWith(".internal"))) throw new ValidationError(BLOCK_MESSAGE);
  }
  if (isIP(host) && !isAllowedKind(ipKind(host))) throw new ValidationError(BLOCK_MESSAGE);
  return url;
}

/**
 * 호스트명을 실제로 해석해 모든 주소가 허용 범위인지 확인한다(DNS 리바인딩 대비 전송 직전에도 호출).
 * 해석 자체가 실패하면(오프라인·존재하지 않는 도메인) 판단을 보류하고 통과시킨다. 전송은 어차피 실패한다.
 */
export async function assertResolvesSafe(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!isAllowedKind(ipKind(host))) throw new ValidationError(BLOCK_MESSAGE);
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return;
  }
  if (addrs.some((a) => !isAllowedKind(ipKind(a.address)))) throw new ValidationError(BLOCK_MESSAGE);
}
