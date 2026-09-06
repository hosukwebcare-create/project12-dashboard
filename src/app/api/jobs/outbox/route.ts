import { NextResponse, type NextRequest } from "next/server";
import { assertJobSecret } from "@/lib/jobs";
import { JOB_LOCK, withJobLock } from "@/lib/scheduler";
import { dispatchOutbox } from "@/modules/outbox/repo";

/** 외부 스케줄러에서 주기 호출: 메신저 웹훅 이벤트를 전송한다 (앱 안 스케줄러와 같은 잠금을 쓴다) */
export async function POST(req: NextRequest) {
  const denied = assertJobSecret(req);
  if (denied) return denied;
  const result = await withJobLock(JOB_LOCK.outbox, () => dispatchOutbox(undefined, 100));
  return NextResponse.json(result ?? { skipped: "이미 실행 중" });
}
