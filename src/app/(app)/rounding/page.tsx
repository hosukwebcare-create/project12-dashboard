import { ChevronLeft, ChevronRight, UserRound } from "lucide-react";
import Link from "next/link";
import { DaySheet } from "@/components/app/day-sheet";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { getCtx } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { addDays, toDateKey, todayKey } from "@/lib/rules/week";
import { clearCellAction, completeRoundAction, copyPreviousRoundAction, fillRemainingAction, saveCellAction } from "@/modules/rounding/actions";
import { daySheet } from "@/modules/rounding/repo";

export const metadata = { title: "라운딩" };

/**
 * 라운딩 하루 표. 시트의 하루 블록(출석·플래너·R1…Rn·영단어·점검완료)을 그대로 한 화면에 둔다.
 * 태블릿으로 돌면서 누르기만 하고, 메모는 PC 에서 같은 표에 적는다. 인쇄도 이 표 그대로 나온다.
 * 여기 적은 것이 곧 매장 모니터(현황판)라서 시트에 다시 옮기지 않는다.
 */
async function RoundingPage({ searchParams }: { searchParams: Promise<{ date?: string; round?: string }> }) {
  const ctx = await getCtx();
  const sp = await searchParams;
  const today = todayKey();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const sheet = await daySheet(ctx, date);
  const done = sheet.sessions.filter((s) => s.completedAt).length;
  const focusRound = sp.round && /^\d+$/.test(sp.round) ? Number(sp.round) : null;
  const prev = toDateKey(addDays(date, -1));
  const next = toDateKey(addDays(date, 1));

  return (
    <div>
      <PageHeader
        title="라운딩"
        description={`${ctx.branchName} · ${fmtShortDate(date)} · 완료 ${done}/${ctx.settings.roundsPerDay}회차 · 여기 적은 것이 매장 모니터에 1분 안에 그대로 보입니다`}
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button asChild variant="outline" size="icon" className="size-9">
                <Link href={`/rounding?date=${prev}`} aria-label="전날">
                  <ChevronLeft />
                </Link>
              </Button>
              {date !== today ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/rounding">오늘</Link>
                </Button>
              ) : null}
              <Button asChild variant="outline" size="icon" className="size-9">
                <Link href={`/rounding?date=${next}`} aria-label="다음 날">
                  <ChevronRight />
                </Link>
              </Button>
            </div>
            {ctx.role === "assistant" ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/switch">
                  <UserRound /> 전환
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <DaySheet
        key={date}
        date={date}
        isToday={date === today}
        branchName={ctx.branchName}
        columns={sheet.columns}
        members={sheet.members}
        cells={sheet.cells}
        rules={sheet.rules}
        sessions={sheet.sessions}
        canEdit={ctx.role !== "mentor"}
        focusRound={focusRound}
        saveAction={saveCellAction}
        clearAction={clearCellAction}
        copyPrevAction={copyPreviousRoundAction}
        completeAction={completeRoundAction}
        fillRestAction={fillRemainingAction}
      />
    </div>
  );
}

export default guarded(RoundingPage);
