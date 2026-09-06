import Link from "next/link";
import { GradeChip } from "@/components/app/grade-chip";
import { Button } from "@/components/ui/button";
import { fmtShortDate } from "@/lib/format";
import { addDays, toDateKey } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import type { MemberWeek } from "@/modules/rounding/repo";

export function MemberWeekView({ memberId, week }: { memberId: string; week: MemberWeek }) {
  const cols: { key: string; roundNo: number; label: string }[] = [];
  for (const it of week.items) {
    if (it.kind === "round") for (let n = 1; n <= week.roundsPerDay; n++) cols.push({ key: it.key, roundNo: n, label: `R${n}` });
    else cols.push({ key: it.key, roundNo: 0, label: it.label });
  }
  const prev = toDateKey(addDays(week.weekStart, -7));
  const next = toDateKey(addDays(week.weekStart, 7));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/members/${memberId}?week=${prev}#week`}>이전 주</Link>
        </Button>
        <span className="text-sm font-medium">{fmtShortDate(week.weekStart)} 주</span>
        <Button asChild variant="outline" size="sm">
          <Link href={`/members/${memberId}?week=${next}#week`}>다음 주</Link>
        </Button>
        <span className={cn("ml-auto text-sm font-semibold tabular-nums", week.totalPoints > 0 ? "text-red-600" : "text-muted-foreground")}>주간 벌점 {week.totalPoints}점</span>
      </div>
      <div className="overflow-x-auto rounded-xl bg-card shadow-(--shadow-card) ring-1 ring-border">
        <table className="text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="sticky left-0 bg-muted/50 px-2 py-1 text-left">일자</th>
              {cols.map((c) => (
                <th key={`${c.key}-${c.roundNo}`} className="px-1 py-1 text-center font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {week.days.map((d) => (
              <tr key={d} className="border-t">
                <td className="sticky left-0 bg-background px-2 py-1 whitespace-nowrap">{fmtShortDate(d)}</td>
                {cols.map((c) => {
                  const cell = week.cells[`${d}|${c.key}|${c.roundNo}`];
                  return (
                    <td key={`${c.key}-${c.roundNo}`} className="px-0.5 py-0.5 text-center" title={cell ? `${cell.ruleName ?? ""} ${cell.note ?? ""}`.trim() : ""}>
                      <GradeChip grade={cell?.grade ?? null} points={cell?.points} className="min-w-7" />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
