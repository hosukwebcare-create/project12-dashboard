import { NextResponse, type NextRequest } from "next/server";
import { tryGetCtx } from "@/lib/auth/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { withRequestRls } from "@/lib/rls";
import { getMemberFile } from "@/modules/files/repo";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tryGetCtx();
  if (!ctx) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const { id } = await params;
  try {
    const { meta, data } = await withRequestRls(() => getMemberFile(ctx, id));
    const inline = meta.mimeType === "application/pdf" || meta.mimeType.startsWith("image/");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": meta.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // 올린 파일이 우리 사이트 권한으로 무언가를 실행하지 못하게 격리한다. PDF 는 브라우저 PDF 뷰어가 격리된 문서에서 열리지 않아 뺀다
        // (PDF 뷰어는 자체 격리 안에서 돌고, 형식은 내용으로 판정해 PDF·PNG·JPEG 만 받는다)
        ...(meta.mimeType === "application/pdf" ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:" }),
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
