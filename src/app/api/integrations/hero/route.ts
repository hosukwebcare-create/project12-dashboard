import { NextResponse, type NextRequest } from "next/server";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ingestHeroResult, verifyHeroSignature, type HeroPayload } from "@/modules/hero/repo";

/**
 * HERO 학습진단 웹앱 → 플랫폼 결과 전송.
 * 헤더 x-hero-signature = HMAC-SHA256(원문 body, HERO_WEBHOOK_SECRET) hex
 * body: { branchCode, memberPhone?, memberName?, seatNo?, externalId, summary, resultUrl?, takenAt? }
 */
export async function POST(req: NextRequest) {
  const secret = process.env.HERO_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "HERO_WEBHOOK_SECRET 이 설정되지 않았습니다" }, { status: 503 });
  const raw = await req.text();
  if (!verifyHeroSignature(raw, req.headers.get("x-hero-signature"), secret)) {
    return NextResponse.json({ error: "서명이 올바르지 않습니다" }, { status: 401 });
  }
  let payload: HeroPayload;
  try {
    payload = JSON.parse(raw) as HeroPayload;
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 });
  }
  try {
    const r = await ingestHeroResult({ ...payload, summary: payload.summary ?? {}, resultUrl: payload.resultUrl ?? null, takenAt: payload.takenAt ?? null });
    return NextResponse.json(r, { status: r.created ? 201 : 200 });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 422 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
