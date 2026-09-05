import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AccessDenied } from "@/components/app/access-denied";
import { ForbiddenError, NotFoundError } from "./errors";
import { withRequestRls } from "./rls";

/**
 * 페이지·레이아웃 렌더링을 감싼다.
 * 운영 빌드에서는 서버 오류의 이름·메시지가 클라이언트로 전달되지 않으므로,
 * 권한 오류는 여기서 화면으로 바꾸고, 없는 항목은 notFound()로 넘긴다.
 * 렌더링은 로그인 지점의 RLS 트랜잭션 안에서 실행된다 (withRequestRls).
 */
export function guarded<P>(render: (props: P) => Promise<ReactNode>) {
  return async function Guarded(props: P): Promise<ReactNode> {
    try {
      return await withRequestRls(() => render(props));
    } catch (e) {
      if (e instanceof ForbiddenError) return <AccessDenied message={e.message} />;
      if (e instanceof NotFoundError) notFound();
      throw e;
    }
  };
}
