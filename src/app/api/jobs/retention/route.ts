import { NextResponse, type NextRequest } from "next/server";
import { assertJobSecret } from "@/lib/jobs";
import { JOB_LOCK, withJobLock } from "@/lib/scheduler";
import { anonymizeWithdrawnMembers, DEFAULT_RETENTION_DAYS } from "@/modules/retention/repo";

/** 하루 1회 호출: 퇴원 후 RETENTION_DAYS(기본 365)가 지난 회원의 개인정보를 익명화한다 */
export async function POST(req: NextRequest) {
  const denied = assertJobSecret(req);
  if (denied) return denied;
  const days = Number(process.env.RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
  const retentionDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
  const result = await withJobLock(JOB_LOCK.retention, () => anonymizeWithdrawnMembers({ retentionDays }));
  return NextResponse.json(result ?? { skipped: "이미 실행 중" });
}
