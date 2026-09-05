import { withRls, type RlsScope } from "@/db/client";
import { tryGetCtx, type Ctx } from "./auth/ctx";

export function scopeOf(ctx: Pick<Ctx, "branchId" | "userId" | "isHqAdmin"> | null): RlsScope | null {
  return ctx ? { branchId: ctx.branchId, userId: ctx.userId, isHq: ctx.isHqAdmin } : null;
}

/**
 * 로그인 세션이 있으면 그 지점 컨텍스트의 RLS 트랜잭션 안에서 fn 을 실행한다.
 * 페이지(guarded), 서버 액션, 로그인 API 라우트가 이 래퍼를 지난다.
 */
export async function withRequestRls<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = await tryGetCtx();
  return withRls(scopeOf(ctx), fn);
}
