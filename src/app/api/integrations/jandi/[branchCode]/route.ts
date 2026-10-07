import { NextResponse, type NextRequest } from "next/server";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createRequestFromJandi } from "@/modules/handover/repo";

/** 잔디가 받아들이는 응답 본문. 200 이 아니면 잔디가 아무것도 보여 주지 않으므로 사람이 볼 오류도 200 으로 답한다 */
const reply = (body: string, color = "#006CD6", status = 200) => NextResponse.json({ body, connectColor: color }, { status });
const MAX_BODY = 64 * 1024;

/**
 * 잔디 아웃고잉 웹훅 → '해 주세요'.
 * 잔디 커넥트에서 키워드(예: 해주세요)와 이 주소를 등록하면, 대화방에 '/해주세요 …' 라고 쓸 때마다 잔디가 여기로 POST 한다.
 * body: { token, teamName, roomName, writer:{name,…} | writerName, text, data, keyword, createdAt, … }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ branchCode: string }> }) {
  const { branchCode } = await params;
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "본문이 너무 큽니다" }, { status: 413 });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 });
  try {
    const r = await createRequestFromJandi(branchCode, payload);
    return reply(`'해 주세요'에 올렸습니다: ${r.body.split("\n")[0].slice(0, 200)}`, "#2E9E5B");
  } catch (e) {
    if (e instanceof ValidationError) return reply(`올리지 못했습니다 — ${e.message}`, "#F26B1D");
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 401 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
