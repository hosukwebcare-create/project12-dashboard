import Link from "next/link";
import { CounselEntry } from "@/components/app/counsel-entry";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { getCtx } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { getLog } from "@/modules/counsel/repo";
import { guarded } from "@/lib/page-guard";

async function CounselLogPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  const { id } = await params;
  const log = await getLog(ctx, id);
  const isWeekly = log.logType === "weekly";
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`${log.memberName} · ${fmtShortDate(log.periodDate)} ${isWeekly ? "주간 상담" : "집중관리 일지"}`}
        description={`${log.seatNo ? `${log.seatNo}번` : "좌석 미배정"} · ${ctx.branchName}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/members/${log.memberId}`}>회원 상세</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={isWeekly ? `/counsel/weekly?week=${log.periodDate}` : `/counsel/focus?memberId=${log.memberId}`}>목록</Link>
            </Button>
          </>
        }
      />
      <CounselEntry memberId={log.memberId} logType={log.logType} periodDate={log.periodDate} log={log} role={ctx.role} />
    </div>
  );
}

export default guarded(CounselLogPage);
