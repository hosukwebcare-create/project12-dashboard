import { NextResponse, type NextRequest } from "next/server";
import { NotFoundError } from "@/lib/errors";
import { todayKey } from "@/lib/rules/week";
import { boardData, verifyBoardToken } from "@/modules/board/repo";

export async function GET(req: NextRequest, { params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = await params;
  const token = req.nextUrl.searchParams.get("t");
  if (!(await verifyBoardToken(branchId, token))) {
    return NextResponse.json({ error: "토큰이 올바르지 않습니다" }, { status: 401 });
  }
  const week = req.nextUrl.searchParams.get("week") ?? todayKey();
  try {
    const data = await boardData(branchId, week);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
