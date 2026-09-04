import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/** 배치 엔드포인트 보호: `x-job-secret` 헤더가 JOB_SECRET 과 같아야 한다 */
export function assertJobSecret(req: NextRequest): NextResponse | null {
  const expected = process.env.JOB_SECRET;
  if (!expected) return NextResponse.json({ error: "JOB_SECRET 이 설정되지 않았습니다" }, { status: 503 });
  const given = req.headers.get("x-job-secret") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "권한이 없습니다" }, { status: 401 });
  return null;
}
