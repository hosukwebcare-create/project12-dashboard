import Link from "next/link";
import { GradeChip } from "@/components/app/grade-chip";
import { PageHeader } from "@/components/app/page-header";
import { getCtx } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { todayKey } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import { dayHistory, recentSessionDates } from "@/modules/rounding/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "라운딩 조회" };

async function RoundingHistoryPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await getCtx();
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKey();
  const [dates, history] = await Promise.all([recentSessionDates(ctx), dayHistory(ctx, date)]);
  const rounds = history.sessions.map((s) => s.roundNo);

  return (
    <div>
      <PageHeader title="라운딩 조회" description={`${ctx.branchName} · ${fmtShortDate(date)}`} />
      <div className="mb-4 flex flex-wrap gap-2">
        {(dates.includes(date) ? dates : [date, ...dates]).map((d) => (
          <Link key={d} href={`/rounding/history?date=${d}`} className={cn("rounded-full border px-3 py-1 text-sm", d === date ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>
            {fmtShortDate(d)}
          </Link>
        ))}
      </div>
      {rounds.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">이 날짜에는 라운딩 기록이 없습니다</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left">좌석</th>
                <th className="px-2 py-2 text-left">이름</th>
                {rounds.map((n) => (
                  <th key={n} className="px-1 py-2 text-center">
                    <Link href={`/rounding/${history.sessions.find((s) => s.roundNo === n)!.id}`} className="hover:underline">
                      R{n}
                    </Link>
                  </th>
                ))}
                <th className="px-2 py-2 text-right">벌점</th>
              </tr>
            </thead>
            <tbody>
              {history.rows.map((r) => {
                const pts = Object.values(r.byRound).reduce((a, c) => a + (c.grade === "p" ? c.points : 0), 0);
                return (
                  <tr key={r.memberId} className="border-t">
                    <td className="px-2 py-1.5 tabular-nums">{r.seatNo ?? "-"}</td>
                    <td className="px-2 py-1.5">
                      <Link href={`/members/${r.memberId}`} className="hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    {rounds.map((n) => (
                      <td key={n} className="px-1 py-1.5 text-center">
                        <GradeChip grade={r.byRound[n]?.grade ?? null} points={r.byRound[n]?.points} />
                      </td>
                    ))}
                    <td className={cn("px-2 py-1.5 text-right font-semibold tabular-nums", pts > 0 && "text-red-600")}>{pts || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default guarded(RoundingHistoryPage);
