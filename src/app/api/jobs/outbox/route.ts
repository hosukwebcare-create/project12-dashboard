import { NextResponse, type NextRequest } from "next/server";
import { assertJobSecret } from "@/lib/jobs";
import { dispatchOutbox } from "@/modules/outbox/repo";

/** Cloud Scheduler 등에서 주기 호출: 메신저 웹훅 이벤트를 전송한다 */
export async function POST(req: NextRequest) {
  const denied = assertJobSecret(req);
  if (denied) return denied;
  const result = await dispatchOutbox(undefined, 100);
  return NextResponse.json(result);
}
