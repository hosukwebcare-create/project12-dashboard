import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { getCtx, requireRole, STAFF_ROLES } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { addDays, toDateKey, todayKey, weekStart, weeksInMonth } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import { weeklyGrid, type CounselCell } from "@/modules/counsel/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "주간 상담일지" };

type Search = { week?: string; month?: string };

async function WeeklyCounselPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await getCtx();
  requireRole(ctx, ...STAFF_ROLES);
  const sp = await searchParams;

  let weeks: string[];
  let title: string;
  let prevHref: string;
  let nextHref: string;
  if (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) {
    const [y, m] = sp.month.split("-").map(Number);
    weeks = weeksInMonth(y, m).map(toDateKey);
    title = `${y}년 ${m}월`;
    const prev = new Date(y, m - 2, 1);
    const next = new Date(y, m, 1);
    prevHref = `/counsel/weekly?month=${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
    nextHref = `/counsel/weekly?month=${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  } else {
    const end = toDateKey(weekStart(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : todayKey()));
    weeks = [-3, -2, -1, 0].map((i) => toDateKey(addDays(end, i * 7)));
    title = `최근 4주 (~${fmtShortDate(end)} 주)`;
    prevHref = `/counsel/weekly?week=${toDateKey(addDays(end, -28))}`;
    nextHref = `/counsel/weekly?week=${toDateKey(addDays(end, 28))}`;
  }
  const grid = await weeklyGrid(ctx, weeks);
  const thisMonth = todayKey().slice(0, 7);

  return (
    <div>
      <PageHeader
        title="주간 상담일지"
        description={`${ctx.branchName} · ${title}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={prevHref} aria-label="이전">
                <ChevronLeft />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={nextHref} aria-label="다음">
                <ChevronRight />
              </Link>
            </Button>
            <Button asChild variant={sp.month ? "default" : "outline"} size="sm">
              <Link href={`/counsel/weekly?month=${sp.month ?? thisMonth}`}>월별</Link>
            </Button>
            <Button asChild variant={!sp.month ? "default" : "outline"} size="sm">
              <Link href="/counsel/weekly">최근 4주</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/counsel/focus">집중관리 일지</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/counsel/schedule">상담 일정</Link>
            </Button>
          </>
        }
      />
      <div className="overflow-x-auto rounded-lg bg-card ring-1 ring-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-muted/50 px-2 py-2 text-left">좌석</th>
              <th className="sticky left-12 z-10 bg-muted/50 px-2 py-2 text-left">이름</th>
              {weeks.map((w) => (
                <th key={w} className="px-2 py-2 text-left">
                  {fmtShortDate(w)} 주
                  <div className="mt-0.5 flex gap-1 text-[10px] font-normal">
                    <span className="w-1/2">원장</span>
                    <span className="w-1/2">멘토</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.members.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="sticky left-0 z-10 bg-background px-2 py-1.5 tabular-nums">{m.seatNo ?? "-"}</td>
                <td className="sticky left-12 z-10 bg-background px-2 py-1.5">
                  <Link href={`/members/${m.id}`} className="font-medium hover:underline">
                    {m.name}
                  </Link>
                  {m.focusCare ? <span className="ml-1 text-[10px] text-violet-700">집중</span> : null}
                </td>
                {weeks.map((w) => (
                  <td key={w} className="px-1 py-1">
                    <Cell memberId={m.id} week={w} cell={grid.cells[`${m.id}|${w}`]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ memberId, week, cell }: { memberId: string; week: string; cell?: CounselCell }) {
  const href = cell ? `/counsel/logs/${cell.logId}` : `/counsel/entry?memberId=${memberId}&logType=weekly&periodDate=${week}`;
  return (
    <Link href={href} className="flex min-w-40 gap-1 rounded-md border p-1 hover:bg-muted/60">
      <Part text={cell?.issueText ?? null} tone="issue" />
      <Part text={cell?.resolutionText ?? null} tone="resolution" />
      {cell && cell.commentCount > 0 ? (
        <span className="flex items-center gap-0.5 self-start text-[10px] text-sky-700">
          <MessageSquare className="size-3" />
          {cell.commentCount}
        </span>
      ) : null}
    </Link>
  );
}

function Part({ text, tone }: { text: string | null; tone: "issue" | "resolution" }) {
  return (
    <span className={cn("block h-9 w-1/2 overflow-hidden rounded px-1 text-[11px] leading-tight", text ? (tone === "issue" ? "bg-muted text-foreground" : "bg-emerald-50 text-emerald-900") : "text-muted-foreground")}>
      {text ? text.slice(0, 40) : "미작성"}
    </span>
  );
}

export default guarded(WeeklyCounselPage);
