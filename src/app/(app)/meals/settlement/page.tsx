import Link from "next/link";
import { InlineForm } from "@/components/app/inline-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCtx, MANAGER_ROLES, requireRole } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { todayKey } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import { markPaidAction } from "@/modules/meals/actions";
import { monthlySettlement } from "@/modules/meals/repo";

export const metadata = { title: "식사 월 정산" };

function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function SettlementPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await getCtx();
  requireRole(ctx, ...MANAGER_ROLES);
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : shiftMonth(todayKey().slice(0, 7), 0);
  const st = await monthlySettlement(ctx, month);
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/meals/settlement?month=${shiftMonth(month, -1)}`}>이전 달</Link>
        </Button>
        <span className="text-sm font-medium">{month.replace("-", "년 ")}월 정산</span>
        <Button asChild variant="outline" size="sm">
          <Link href={`/meals/settlement?month=${shiftMonth(month, 1)}`}>다음 달</Link>
        </Button>
        <span className="ml-auto text-sm">
          총 {st.totals.mealCount}식 · 청구 {st.totals.amount.toLocaleString()}원 · 입금 {st.totals.paidAmount.toLocaleString()}원 · 미수{" "}
          <span className={cn("font-semibold", st.totals.amount - st.totals.paidAmount > 0 && "text-red-600")}>{(st.totals.amount - st.totals.paidAmount).toLocaleString()}원</span>
        </span>
      </div>
      {st.rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">이 달의 주문이 없습니다</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {st.rows.map((r) => (
            <InlineForm key={r.memberId} action={markPaidAction} className="px-3 py-2">
              <input type="hidden" name="memberId" value={r.memberId} />
              <input type="hidden" name="yearMonth" value={month} />
              <span className="w-10 tabular-nums text-muted-foreground">{r.seatNo ?? "-"}</span>
              <span className="w-20 font-medium">{r.name}</span>
              <span className="w-16 text-sm">{r.mealCount}식</span>
              <span className="w-24 text-sm tabular-nums">{r.amount.toLocaleString()}원</span>
              <Input name="paidAt" type="date" defaultValue={r.paidAt ?? ""} className="w-40" aria-label="결제일" />
              <Input name="paidAmount" type="number" min={0} step={1000} defaultValue={r.paidAmount ?? ""} placeholder={String(r.amount)} className="w-28" aria-label="결제액" />
              <Input name="note" defaultValue={r.note ?? ""} placeholder="메모" className="w-32" />
              <span className={cn("w-24 text-sm tabular-nums", r.balance > 0 ? "text-red-600" : "text-emerald-700")}>{r.balance > 0 ? `미수 ${r.balance.toLocaleString()}` : "완납"}</span>
            </InlineForm>
          ))}
        </div>
      )}
    </div>
  );
}

export default guarded(SettlementPage);
