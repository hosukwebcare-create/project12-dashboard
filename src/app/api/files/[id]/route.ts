import { NextResponse, type NextRequest } from "next/server";
import { tryGetCtx } from "@/lib/auth/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getMemberFile } from "@/modules/files/repo";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tryGetCtx();
  if (!ctx) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const { id } = await params;
  try {
    const { meta, data } = await getMemberFile(ctx, id);
    const inline = meta.mimeType === "application/pdf" || meta.mimeType.startsWith("image/");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": meta.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
