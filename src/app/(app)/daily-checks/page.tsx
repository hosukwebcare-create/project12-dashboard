import Link from "next/link";
import { CheckSheet } from "@/components/app/check-sheet";
import { PageHeader } from "@/components/app/page-header";
import { getCtx, requireRole } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { addDays, toDateKey, todayKey } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import { saveCheckAction } from "@/modules/rounding/actions";
import { penaltyRulesFor, sheetRows } from "@/modules/rounding/repo";
import { boardItemsFor } from "@/modules/settings/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "일별 체크" };

async function DailyChecksPage({ searchParams }: { searchParams: Promise<{ item?: string; date?: string }> }) {
  const ctx = await getCtx();
  requireRole(ctx, "hq_admin", "branch_manager", "assistant");
  const sp = await searchParams;
  const items = (await boardItemsFor(ctx)).filter((i) => i.kind === "daily");
  const item = items.find((i) => i.key === sp.item) ?? items[0];
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKey();
  if (!item) return <p className="text-sm text-muted-foreground">현황판 항목이 설정되지 않았습니다</p>;
  const [rows, rules] = await Promise.all([sheetRows(ctx, date, item.key, 0), penaltyRulesFor(ctx)]);
  const dates = [-2, -1, 0].map((d) => toDateKey(addDays(todayKey(), d)));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="일별 체크" description={`${ctx.branchName} · ${fmtShortDate(date)}`} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {items.map((i) => (
          <Link key={i.key} href={`/daily-checks?item=${i.key}&date=${date}`} className={cn("rounded-full border px-3 py-1 text-sm", i.key === item.key ? "bg-foreground text-background" : "text-muted-foreground")}>
            {i.label}
          </Link>
        ))}
        <span className="mx-1 text-muted-foreground">|</span>
        {dates.map((d) => (
          <Link key={d} href={`/daily-checks?item=${item.key}&date=${d}`} className={cn("rounded-full border px-3 py-1 text-sm", d === date ? "bg-foreground text-background" : "text-muted-foreground")}>
            {fmtShortDate(d)}
          </Link>
        ))}
      </div>
      <CheckSheet key={`${item.key}-${date}`} date={date} itemKey={item.key} roundNo={0} rows={rows} rules={rules} saveAction={saveCheckAction} />
    </div>
  );
}

export default guarded(DailyChecksPage);
