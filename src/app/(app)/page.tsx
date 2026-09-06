import Link from "next/link";
import { redirect } from "next/navigation";
import { IssueStatusBadge, SeverityBadge } from "@/components/app/issue-badges";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCtx, ROLE_LABEL } from "@/lib/auth/ctx";
import { fmtDate, fmtRelative, fmtShortDate } from "@/lib/format";
import { todayKey } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import { dashboard, hqOverview } from "@/modules/dashboard/repo";
import { guarded } from "@/lib/page-guard";

async function DashboardPage() {
  const ctx = await getCtx();
  if (ctx.role === "assistant") redirect("/rounding");
  const today = todayKey();
  const [d, overview] = await Promise.all([dashboard(ctx, today), ctx.isHqAdmin ? hqOverview(ctx, today) : Promise.resolve(null)]);

  return (
    <div>
      <PageHeader title="대시보드" description={`${ctx.branchName} · ${fmtShortDate(today)} · ${ROLE_LABEL[ctx.role]} ${ctx.userName}`} />

      {overview ? (
        <Card className="mb-6">
          <CardHeader className="border-b">
            <CardTitle>전 지점 요약</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">지점</th>
                    <th className="py-1.5 pr-3 text-right font-medium">등록 회원</th>
                    <th className="py-1.5 pr-3 text-right font-medium">오늘 라운딩</th>
                    <th className="py-1.5 pr-3 text-right font-medium">미해결 이슈</th>
                    <th className="py-1.5 pr-3 text-right font-medium">상담 미작성</th>
                    <th className="py-1.5 text-right font-medium">주간 벌점(상위5 합)</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.map((b) => (
                    <tr key={b.branchId} className={cn("border-t border-border", b.branchId === ctx.branchId && "font-medium")}>
                      <td className="py-2 pr-3">{b.branchName}</td>
                      <td className="py-2 pr-3 text-right">{b.enrolled}</td>
                      <td className="py-2 pr-3 text-right">
                        {b.sessionsDone}/{b.roundsPerDay}
                      </td>
                      <td className="py-2 pr-3 text-right">{b.openIssues}</td>
                      <td className="py-2 pr-3 text-right">{b.missingWeekly}</td>
                      <td className="py-2 text-right">{b.weeklyPoints}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">상단의 지점 선택으로 전환하면 아래 내용이 그 지점 기준으로 바뀝니다.</p>
          </CardContent>
        </Card>
      ) : null}

      {/* 지표 행: 카드 대신 얇은 세로선으로 나눈다 */}
      <div className="grid gap-6 border-b border-border pb-6 md:grid-cols-3 md:gap-0">
        <StatCard label="오늘 라운딩" value={d.sessionsDone} unit={`/ ${d.roundsPerDay} 회차`} href="/rounding/history" hint="회차별 결과 보기" />
        <StatCard label="이번 주 상담일지 미작성" value={d.missingWeekly} unit="명" tone={d.missingWeekly > 0 ? "warning" : "default"} href={`/counsel/weekly?week=${d.weekStart}`} hint={`${fmtShortDate(d.weekStart)} 주 상담일지 열기`} />
        <StatCard label="등록 만료 임박 (7일)" value={d.expiring.length} unit="명" tone={d.expiring.length > 0 ? "warning" : "default"}>
          {d.expiring.length ? (
            <ul className="space-y-1 text-[13px]">
              {d.expiring.slice(0, 4).map((e) => (
                <li key={e.memberId} className="flex justify-between gap-2">
                  <Link href={`/members/${e.memberId}`} className="truncate hover:underline">
                    {e.seatNo ?? "-"}번 {e.name}
                  </Link>
                  <span className="shrink-0 text-muted-foreground">
                    {fmtDate(e.endDate)} · {e.daysLeft}일
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">이번 주 만료 예정이 없습니다.</p>
          )}
        </StatCard>
      </div>

      <div className="mt-6 grid gap-8 md:grid-cols-5">
        <section className="md:col-span-3">
          <h2 className="mb-3 flex items-baseline justify-between text-sm font-semibold">
            미해결 이슈
            <span className="text-xs font-normal text-muted-foreground">{d.openIssues.length}건</span>
          </h2>
          {d.openIssues.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">미해결 이슈가 없습니다</p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {d.openIssues.map((i) => (
                <li key={i.id}>
                  <Link href={`/issues/${i.id}`} className="flex flex-wrap items-center gap-2 py-2.5 text-sm hover:bg-muted/40">
                    <SeverityBadge severity={i.severity} />
                    <span className="font-medium">{i.title}</span>
                    <IssueStatusBadge status={i.status} />
                    <span className="ml-auto text-xs text-muted-foreground">{fmtRelative(i.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/issues" className="mt-3 inline-block text-[13px] text-muted-foreground hover:text-foreground hover:underline">
            이슈함 전체 보기
          </Link>
        </section>

        <section className="md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">이번 주 벌점 상위</h2>
          {d.topPenalties.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">이번 주 벌점이 없습니다</p>
          ) : (
            <ol className="divide-y divide-border border-y border-border text-sm">
              {d.topPenalties.map((p, i) => (
                <li key={p.memberId} className="flex items-center gap-3 py-2">
                  <span className="w-4 text-xs text-muted-foreground">{i + 1}</span>
                  <Link href={`/members/${p.memberId}`} className="flex-1 truncate hover:underline">
                    <span className="text-muted-foreground">{p.seatNo ?? "-"}번</span> {p.name}
                  </Link>
                  <span className="font-medium text-rose-700">{p.points}점</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

export default guarded(DashboardPage);
