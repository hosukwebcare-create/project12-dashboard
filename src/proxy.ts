import { NextResponse, type NextRequest } from "next/server";
import { sessionCookie, verifySession } from "@/lib/auth/session";
import { clientIp } from "@/lib/client-ip";
import { hitRateLimit, PUBLIC_RATE_RULES } from "@/lib/rate-limit";

/** 로그인 없이 접근 가능한 경로 */
const PUBLIC_PREFIXES = ["/login", "/setup", "/board/", "/api/board/", "/api/integrations/", "/api/jobs/", "/api/health"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    // 로그인 없이 열린 주소는 IP 당 요청 수를 제한한다(토큰을 찍어 보거나 DB 조회를 마구 일으키지 못하게)
    const r = PUBLIC_RATE_RULES.find((x) => pathname.startsWith(x.prefix));
    if (r) {
      const gate = hitRateLimit(`${r.group}:${clientIp(req.headers)}`, r.rule);
      if (!gate.ok) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요" }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });
    }
    return NextResponse.next();
  }

  // 여기서는 서명만 본다(빠르게 로그인 화면으로 보내려고). 세션이 서버에서 살아 있는지는 페이지·액션의 getCtx 가 본다
  const session = await verifySession(req.cookies.get(sessionCookie.name)?.value);
  if (!session) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
