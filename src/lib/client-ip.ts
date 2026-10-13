import { isIP } from "node:net";
import { ipKind } from "./net";

/**
 * 요청한 사람의 IP. 로그인 차단·요청 수 제한·보안 기록이 이 값을 쓴다.
 *
 * X-Forwarded-For 는 "클라이언트가 보낸 값, …, 프록시가 덧붙인 값" 순서다. 맨 앞은 요청자가 마음대로 적을 수 있어서,
 * 그걸 믿으면 매번 다른 값을 넣는 것만으로 IP 차단을 피해 간다. 그래서 오른쪽(우리 프록시가 붙인 쪽)부터 읽는다.
 * - 사설·루프백 주소는 우리 쪽 내부 프록시이므로 건너뛴다.
 * - TRUSTED_PROXY_HOPS(기본 1)는 공인 IP 를 덧붙이는 프록시 단계 수. Cloudflare 같은 것을 앞에 두면 2.
 * 헤더가 없으면 X-Real-IP, 그것도 없으면 "unknown".
 */
export function clientIp(headers: Headers): string {
  const hops = Math.max(1, Math.floor(Number(process.env.TRUSTED_PROXY_HOPS ?? 1)) || 1);
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => normalize(s))
    .filter((s): s is string => s !== null);
  const publicFromRight = chain.filter((ip) => ipKind(ip) === "public").reverse();
  if (publicFromRight.length > 0) return publicFromRight[Math.min(hops, publicFromRight.length) - 1];
  if (chain.length > 0) return chain[chain.length - 1];
  return normalize(headers.get("x-real-ip") ?? "") ?? "unknown";
}

/** "1.2.3.4:5678", "[::1]:80", 공백을 걷어 내고 IP 가 아니면 null */
function normalize(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  const bracket = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket) s = bracket[1];
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  s = s.toLowerCase();
  return isIP(s) ? s : null;
}

/** 보안 기록용 브라우저 정보. 길이를 자른다 */
export function userAgentOf(headers: Headers): string | null {
  const ua = headers.get("user-agent")?.trim();
  return ua ? ua.slice(0, 300) : null;
}
