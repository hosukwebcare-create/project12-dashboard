import Link from "next/link";
import { CheckSheet } from "@/components/app/check-sheet";
import { PageHeader } from "@/components/app/page-header";
import { getCtx, requireRole } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { addDays, toDateKey, todayKey } from "@/lib/rules/week";
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
      <div className="pill-nav mb-3">
        {items.map((i) => (
          <Link key={i.key} href={`/daily-checks?item=${i.key}&date=${date}`} className="pill" data-active={i.key === item.key}>
            {i.label}
          </Link>
        ))}
        <span className="mx-1 my-1 w-px self-stretch bg-border" aria-hidden />
        {dates.map((d) => (
          <Link key={d} href={`/daily-checks?item=${item.key}&date=${d}`} className="pill" data-active={d === date}>
            {fmtShortDate(d)}
          </Link>
        ))}
      </div>
      <CheckSheet key={`${item.key}-${date}`} date={date} itemKey={item.key} roundNo={0} rows={rows} rules={rules} saveAction={saveCheckAction} />
    </div>
  );
}

export default guarded(DailyChecksPage);
