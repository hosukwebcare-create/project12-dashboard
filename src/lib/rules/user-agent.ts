/**
 * 브라우저 정보(User-Agent)를 사람이 알아볼 이름으로. 로그인된 기기 목록과 보안 기록에 쓴다.
 * 정확한 판별이 목적이 아니라 "내 폰인지, 매장 태블릿인지" 알아보는 정도면 된다.
 */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "알 수 없는 기기";
  const browser = /SamsungBrowser/i.test(ua)
    ? "삼성 인터넷"
    : /KAKAOTALK/i.test(ua)
      ? "카카오톡"
      : /Edg\//.test(ua)
        ? "Edge"
        : /Whale\//.test(ua)
          ? "웨일"
          : /(Chrome|CriOS)\//.test(ua)
            ? "Chrome"
            : /(Firefox|FxiOS)\//.test(ua)
              ? "Firefox"
              : /Safari\//.test(ua)
                ? "Safari"
                : "브라우저";
  const os = /iPad/.test(ua)
    ? "iPad"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? "Android 폰"
          : "Android 태블릿"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return os ? `${browser} · ${os}` : browser;
}
