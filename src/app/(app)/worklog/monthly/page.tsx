import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getCtx, MANAGER_ROLES, requireRole } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { todayKey } from "@/lib/rules/week";
import { formatHours, STAFF_GROUPS } from "@/lib/rules/worklog";
import { hqWorklogSummary, monthlySummary } from "@/modules/worklog/repo";

export const metadata = { title: "근무 월 집계" };

function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function MonthlyWorklogPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await getCtx();
  requireRole(ctx, ...MANAGER_ROLES);
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : todayKey().slice(0, 7);
  const [rows, hq] = await Promise.all([monthlySummary(ctx, month), ctx.isHqAdmin ? hqWorklogSummary(ctx, month) : Promise.resolve(null)]);
  const totalPay = rows.reduce((a, r) => a + (r.estimatedPay ?? 0), 0);
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/worklog/monthly?month=${shiftMonth(month, -1)}`}>이전 달</Link>
        </Button>
        <span className="text-sm font-medium">{month.replace("-", "년 ")}월</span>
        <Button asChild variant="outline" size="sm">
          <Link href={`/worklog/monthly?month=${shiftMonth(month, 1)}`}>다음 달</Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <a href={`/api/worklog/export?month=${month}`}>급여 기초자료 CSV</a>
        </Button>
      </div>
      {hq ? (
        <div className="mb-4 overflow-x-auto rounded-lg bg-card ring-1 ring-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs font-medium tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">지점별 합계 (본사)</th>
                <th className="px-3 py-2 text-right">근무자</th>
                <th className="px-3 py-2 text-right">근무시간</th>
                <th className="px-3 py-2 text-right">초과</th>
                <th className="px-3 py-2 text-right">본사확인</th>
                <th className="px-3 py-2 text-right">예상 급여</th>
              </tr>
            </thead>
            <tbody>
              {hq.map((b) => (
                <tr key={b.branchId} className={b.branchId === ctx.branchId ? "bg-muted/40 font-medium" : ""}>
                  <td className="px-3 py-1.5">{b.branchName}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{b.staff}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatHours(b.hoursX100)}h</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatHours(b.overtimeX100)}h</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatHours(b.confirmedX100)}h</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{b.estimatedPay.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">이 달의 근무 기록이 없습니다</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-card ring-1 ring-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs font-medium tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">근무자</th>
                <th className="px-3 py-2">형태</th>
                <th className="px-3 py-2 text-right">근무일</th>
                <th className="px-3 py-2 text-right">근무시간</th>
                <th className="px-3 py-2 text-right">초과</th>
                <th className="px-3 py-2 text-right">본사확인 시간</th>
                <th className="px-3 py-2 text-right">시급</th>
                <th className="px-3 py-2 text-right">예상 급여</th>
              </tr>
            </thead>
            {STAFF_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r.group === g.key) }))
              .filter((g) => g.rows.length > 0)
              .map((g) => (
            <tbody key={g.key}>
              <tr className="border-t">
                <th colSpan={8} scope="rowgroup" className="bg-muted/30 px-3 py-1.5 text-left text-xs font-semibold">
                  {g.label}
                  <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                    {g.rows.length}명 · {formatHours(g.rows.reduce((a, r) => a + r.hoursX100 + r.overtimeX100, 0))}h
                  </span>
                </th>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.userId} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.userName}</td>
                  <td className="px-3 py-2">{r.employmentType}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.days}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatHours(r.hoursX100)}h</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatHours(r.overtimeX100)}h</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatHours(r.confirmedX100)}h</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.hourlyRate?.toLocaleString() ?? "-"}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.estimatedPay?.toLocaleString() ?? "-"}</td>
                </tr>
              ))}
            </tbody>
              ))}
            <tfoot className="bg-muted/30 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={7}>
                  합계
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{totalPay.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">예상 급여 = (근무시간 + 초과) × 시급. 실제 지급은 본사 확인 시간을 기준으로 급여 담당자가 확정합니다.</p>
    </div>
  );
}

export default guarded(MonthlyWorklogPage);
