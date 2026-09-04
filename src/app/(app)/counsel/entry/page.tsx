import { redirect } from "next/navigation";
import { CounselEntry } from "@/components/app/counsel-entry";
import { PageHeader } from "@/components/app/page-header";
import type { CounselLogType } from "@/db/schema";
import { getCtx, requireRole, STAFF_ROLES } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { findLogId } from "@/modules/counsel/repo";
import { getMember } from "@/modules/members/repo";
import { guarded } from "@/lib/page-guard";

async function CounselEntryPage({ searchParams }: { searchParams: Promise<{ memberId?: string; logType?: string; periodDate?: string }> }) {
  const ctx = await getCtx();
  requireRole(ctx, ...STAFF_ROLES);
  const sp = await searchParams;
  const logType: CounselLogType = sp.logType === "focus_daily" ? "focus_daily" : "weekly";
  const memberId = sp.memberId ?? "";
  const periodDate = sp.periodDate ?? "";
  if (!memberId || !/^\d{4}-\d{2}-\d{2}$/.test(periodDate)) redirect("/counsel/weekly");

  const existing = await findLogId(ctx, memberId, logType, periodDate);
  if (existing) redirect(`/counsel/logs/${existing}`);

  const member = await getMember(ctx, memberId);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`${member.name} · ${logType === "weekly" ? `${fmtShortDate(periodDate)} 주간 상담` : `${fmtShortDate(periodDate)} 집중관리 일지`}`}
        description={`${member.seatNo ? `${member.seatNo}번` : "좌석 미배정"} · ${member.school ?? ""} ${member.grade ?? ""}`}
      />
      <CounselEntry memberId={memberId} logType={logType} periodDate={periodDate} log={null} role={ctx.role} />
    </div>
  );
}

export default guarded(CounselEntryPage);
