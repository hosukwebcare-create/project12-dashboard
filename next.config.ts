import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/** Pretendard 웹폰트를 받아 오는 곳. 폐쇄망이면 이 도메인만 빼면 시스템 서체로 떨어진다 */
const FONT_CDN = "https://cdn.jsdelivr.net";

/**
 * Next 는 하이드레이션용 인라인 스크립트를 심으므로 script-src 에 'unsafe-inline' 이 필요하다.
 * (nonce 를 쓰려면 proxy 에서 모든 응답을 가로채야 해서 라우터 캐시를 잃는다.)
 * 그래도 외부 스크립트 출처·프레임 삽입·폼 전송처를 막아 주는 값이 크다.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  `style-src 'self' 'unsafe-inline' ${FONT_CDN}`,
  `font-src 'self' data: ${FONT_CDN}`,
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // 다른 사이트가 연 창과 이 창이 서로 참조하지 못하게, 다른 사이트가 우리 응답(파일·JSON)을 끌어다 쓰지 못하게
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  // Docker/Cloud Run 배포용 단일 실행 번들
  output: "standalone",
  // 어떤 프레임워크로 만들었는지 알려 주는 X-Powered-By 를 빼서 공격자가 고를 취약점 목록을 줄인다
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
