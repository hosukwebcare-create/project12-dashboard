import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { GradeChip } from "@/components/app/grade-chip";
import { Button } from "@/components/ui/button";
import { fmtShortDate } from "@/lib/format";
import { dayColumns } from "@/lib/rules/rounding";
import { addDays, toDateKey } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import type { MemberWeek } from "@/modules/rounding/repo";

export function MemberWeekView({ memberId, week }: { memberId: string; week: MemberWeek }) {
  // 라운딩 표와 같은 순서·같은 키로 열을 만든다(라운딩 칸은 항목 키와 상관없이 round 로 쌓인다)
  const cols = dayColumns(week.items, week.roundsPerDay).map((c) => ({ key: c.itemKey, roundNo: c.roundNo, label: c.label }));
  const prev = toDateKey(addDays(week.weekStart, -7));
  const next = toDateKey(addDays(week.weekStart, 7));
  const penaltyCount = Object.values(week.cells).filter((c) => c?.grade === "p").length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1">
          <Button asChild variant="ghost" size="icon-sm" aria-label="이전 주">
            <Link href={`/members/${memberId}?week=${prev}#week`}>
              <ChevronLeft />
            </Link>
          </Button>
          <span className="px-2 text-sm font-medium">{fmtShortDate(week.weekStart)} 주</span>
          <Button asChild variant="ghost" size="icon-sm" aria-label="다음 주">
            <Link href={`/members/${memberId}?week=${next}#week`}>
              <ChevronRight />
            </Link>
          </Button>
        </div>
        <span className={cn("ml-auto inline-flex items-center gap-2 text-sm font-medium", week.totalPoints > 0 ? "text-rose-700" : "text-muted-foreground")}>
          주간 벌점 {week.totalPoints}점
          {penaltyCount > 0 ? <span className="text-xs font-normal opacity-80">{penaltyCount}건</span> : null}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg bg-card ring-1 ring-border">
        <table className="text-xs">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className="sticky left-0 bg-muted/60 px-3 py-2 text-left font-medium">일자</th>
              {cols.map((c) => (
                <th key={`${c.key}-${c.roundNo}`} className="px-1 py-2 text-center font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {week.days.map((d) => (
              <tr key={d} className="border-t border-border/70">
                <td className="sticky left-0 bg-card px-3 py-1.5 font-medium whitespace-nowrap">{fmtShortDate(d)}</td>
                {cols.map((c) => {
                  const cell = week.cells[`${d}|${c.key}|${c.roundNo}`];
                  return (
                    <td key={`${c.key}-${c.roundNo}`} className="px-0.5 py-1 text-center" title={cell ? `${cell.ruleName ?? ""} ${cell.note ?? ""}`.trim() : ""}>
                      <GradeChip grade={cell?.grade ?? null} points={cell?.points} className="min-w-7" />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">칸을 가리키면 벌점 규칙과 메모가 보입니다. 초록 양호, 연두 사유, 빨강 벌점(점수), 회색 부재.</p>
    </div>
  );
}
