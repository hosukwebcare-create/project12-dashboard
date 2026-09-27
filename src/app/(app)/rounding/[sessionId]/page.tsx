import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { sessionById } from "@/modules/rounding/repo";

/** 예전 회차 주소. 하루 표의 그 날짜·회차로 넘긴다 (알림·메신저에 남은 링크가 계속 열리도록) */
async function RoundSessionRedirect({ params }: { params: Promise<{ sessionId: string }> }) {
  const ctx = await getCtx();
  const { sessionId } = await params;
  const session = await sessionById(ctx, sessionId);
  return redirect(`/rounding?date=${session.date}&round=${session.roundNo}`);
}

export default guarded(RoundSessionRedirect);
