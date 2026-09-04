import Link from "next/link";
import { MealGridView } from "@/components/app/meal-grid";
import { Button } from "@/components/ui/button";
import { getCtx, MANAGER_ROLES } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { todayKey } from "@/lib/rules/week";
import { monthGrid } from "@/modules/meals/repo";

export const metadata = { title: "식사주문" };

function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function MealsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await getCtx();
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : todayKey().slice(0, 7);
  const grid = await monthGrid(ctx, month);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/meals?month=${shiftMonth(month, -1)}`}>이전 달</Link>
        </Button>
        <span className="text-sm font-medium">{month.replace("-", "년 ")}월</span>
        <Button asChild variant="outline" size="sm">
          <Link href={`/meals?month=${shiftMonth(month, 1)}`}>다음 달</Link>
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          중식 {grid.settings.lunchPrice.toLocaleString()}원 · 석식 {grid.settings.dinnerPrice.toLocaleString()}원 · 전일 {grid.settings.cutoffTime} 마감
          {grid.settings.saturdayLunchOnly ? " · 토 중식만" : ""}
          {grid.settings.sundayClosed ? " · 일 휴무" : ""}
        </span>
      </div>
      <MealGridView key={month} grid={grid} canOverride={MANAGER_ROLES.includes(ctx.role)} />
    </div>
  );
}

export default guarded(MealsPage);
