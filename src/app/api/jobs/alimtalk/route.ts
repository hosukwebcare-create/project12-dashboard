import { NextResponse, type NextRequest } from "next/server";
import { assertJobSecret } from "@/lib/jobs";
import { JOB_LOCK, withJobLock } from "@/lib/scheduler";
import { getProvider } from "@/modules/alimtalk/provider";
import { processQueue } from "@/modules/alimtalk/repo";

/** 외부 스케줄러에서 주기 호출: 대기 중인 알림톡을 발송한다 (앱 안 스케줄러와 같은 잠금을 써 중복 발송을 막는다) */
export async function POST(req: NextRequest) {
  const denied = assertJobSecret(req);
  if (denied) return denied;
  const result = await withJobLock(JOB_LOCK.alimtalk, () => processQueue(getProvider(), 500));
  return NextResponse.json(result ?? { skipped: "이미 실행 중" });
}
