import Link from "next/link";
import { CounselEntry } from "@/components/app/counsel-entry";
import { Button } from "@/components/ui/button";
import { getCtx } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { getLog } from "@/modules/counsel/repo";

async function CounselLogPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  const { id } = await params;
  const log = await getLog(ctx, id);
  const isWeekly = log.logType === "weekly";
  const listHref = isWeekly ? `/counsel/weekly?week=${log.periodDate}` : `/counsel/focus?memberId=${log.memberId}`;
  return (
    <div className="mx-auto max-w-4xl">
      {/* 문서 머리: 종류 · 기간 위에 회원 이름을 크게 */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border pb-5">
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">
            {log.memberName}
            <span className="ml-2 text-lg font-normal text-muted-foreground">{isWeekly ? "주간 상담일지" : "집중관리 일지"}</span>
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {isWeekly ? `${fmtShortDate(log.periodDate)} 주` : fmtShortDate(log.periodDate)} · {log.seatNo ? `${log.seatNo}번 좌석` : "좌석 미배정"} · {ctx.branchName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/members/${log.memberId}`}>회원 상세</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={listHref}>목록</Link>
          </Button>
        </div>
      </div>
      <CounselEntry memberId={log.memberId} logType={log.logType} periodDate={log.periodDate} log={log} role={ctx.role} />
    </div>
  );
}

export default guarded(CounselLogPage);
