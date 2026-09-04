import Link from "next/link";
import { PrintButton } from "@/components/app/print-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCtx } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { addDays, toDateKey, todayKey } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import { dailyOrders, getMealSettings } from "@/modules/meals/repo";

export const metadata = { title: "일별 발주" };

async function DailyMealsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await getCtx();
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKey();
  const [day, settings] = await Promise.all([dailyOrders(ctx, date), getMealSettings(ctx)]);
  const dates = [-1, 0, 1, 2].map((d) => toDateKey(addDays(todayKey(), d)));
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        {(dates.includes(date) ? dates : [date, ...dates]).map((d) => (
          <Link key={d} href={`/meals/daily?date=${d}`} className={cn("rounded-full border px-3 py-1 text-sm", d === date ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>
            {fmtShortDate(d)}
          </Link>
        ))}
        <PrintButton className="ml-auto" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            {fmtShortDate(date)} 도시락 발주서 · {ctx.branchName}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            중식 {day.totals.lunch}개 · 석식 {day.totals.dinner}개{settings.vendorName ? ` · 업체 ${settings.vendorName}${settings.vendorPhone ? ` (${settings.vendorPhone})` : ""}` : ""}
          </p>
        </CardHeader>
        <CardContent>
          {day.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">주문이 없습니다</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">좌석</th>
                  <th className="py-1">이름</th>
                  <th className="py-1 text-center">중식</th>
                  <th className="py-1 text-center">석식</th>
                </tr>
              </thead>
              <tbody>
                {day.rows.map((r) => (
                  <tr key={r.memberId} className="border-t">
                    <td className="py-1 tabular-nums">{r.seatNo ?? "-"}</td>
                    <td className="py-1">{r.name}</td>
                    <td className="py-1 text-center">{r.lunch ? "○" : ""}</td>
                    <td className="py-1 text-center">{r.dinner ? "○" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default guarded(DailyMealsPage);
