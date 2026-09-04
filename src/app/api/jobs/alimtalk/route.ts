import { NextResponse, type NextRequest } from "next/server";
import { assertJobSecret } from "@/lib/jobs";
import { getProvider } from "@/modules/alimtalk/provider";
import { processQueue } from "@/modules/alimtalk/repo";

/** Cloud Scheduler 등에서 주기 호출: 대기 중인 알림톡을 발송한다 */
export async function POST(req: NextRequest) {
  const denied = assertJobSecret(req);
  if (denied) return denied;
  const result = await processQueue(getProvider(), 500);
  return NextResponse.json(result);
}
