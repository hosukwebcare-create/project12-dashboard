import { AlertTriangle, BookOpen, CalendarClock, Footprints, TrendingUp } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { IssueStatusBadge, SeverityBadge } from "@/components/app/issue-badges";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCtx, ROLE_LABEL } from "@/lib/auth/ctx";
import { fmtDate, fmtRelative, fmtShortDate } from "@/lib/format";
import { todayKey } from "@/lib/rules/week";
import { dashboard, hqOverview } from "@/modules/dashboard/repo";
import { Building2 } from "lucide-react";
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
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4" /> 전 지점 요약
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">지점</th>
                    <th className="py-1 pr-3 text-right">등록 회원</th>
                    <th className="py-1 pr-3 text-right">오늘 라운딩</th>
                    <th className="py-1 pr-3 text-right">미해결 이슈</th>
                    <th className="py-1 pr-3 text-right">상담 미작성</th>
                    <th className="py-1 text-right">주간 벌점(상위5 합)</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.map((b) => (
                    <tr key={b.branchId} className={b.branchId === ctx.branchId ? "bg-muted/40 font-medium" : ""}>
                      <td className="py-1.5 pr-3">{b.branchName}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{b.enrolled}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {b.sessionsDone}/{b.roundsPerDay}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{b.openIssues}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{b.missingWeekly}</td>
                      <td className="py-1.5 text-right tabular-nums">{b.weeklyPoints}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">상단의 지점 선택으로 전환하면 아래 카드가 그 지점 기준으로 바뀝니다.</p>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Footprints className="size-4" /> 오늘 라운딩
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              {d.sessionsDone}
              <span className="text-base font-normal text-muted-foreground"> / {d.roundsPerDay} 회차 완료</span>
            </p>
            <Link href="/rounding/history" className="mt-2 inline-block text-sm text-muted-foreground hover:underline">
              회차별 결과 보기
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="size-4" /> 이번 주 상담일지
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              {d.missingWeekly}
              <span className="text-base font-normal text-muted-foreground"> 명 미작성</span>
            </p>
            <Link href={`/counsel/weekly?week=${d.weekStart}`} className="mt-2 inline-block text-sm text-muted-foreground hover:underline">
              {fmtShortDate(d.weekStart)} 주 상담일지 열기
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4" /> 등록 만료 임박 (7일)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.expiring.length === 0 ? (
              <p className="text-sm text-muted-foreground">없음</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {d.expiring.map((e) => (
                  <li key={e.memberId} className="flex justify-between">
                    <Link href={`/members/${e.memberId}`} className="hover:underline">
                      {e.seatNo ?? "-"}번 {e.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {fmtDate(e.endDate)} · {e.daysLeft}일
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4" /> 미해결 이슈
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.openIssues.length === 0 ? (
              <p className="text-sm text-muted-foreground">미해결 이슈가 없습니다</p>
            ) : (
              <ul className="divide-y">
                {d.openIssues.map((i) => (
                  <li key={i.id} className="py-2">
                    <Link href={`/issues/${i.id}`} className="flex flex-wrap items-center gap-2 text-sm hover:underline">
                      <SeverityBadge severity={i.severity} />
                      <span className="font-medium">{i.title}</span>
                      <IssueStatusBadge status={i.status} />
                      <span className="ml-auto text-xs text-muted-foreground">{fmtRelative(i.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/issues" className="mt-2 inline-block text-sm text-muted-foreground hover:underline">
              이슈함 전체 보기
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4" /> 이번 주 벌점 상위
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.topPenalties.length === 0 ? (
              <p className="text-sm text-muted-foreground">이번 주 벌점이 없습니다</p>
            ) : (
              <ol className="space-y-1 text-sm">
                {d.topPenalties.map((p, i) => (
                  <li key={p.memberId} className="flex items-center gap-2">
                    <span className="w-4 text-muted-foreground">{i + 1}</span>
                    <Link href={`/members/${p.memberId}`} className="flex-1 hover:underline">
                      {p.seatNo ?? "-"}번 {p.name}
                    </Link>
                    <span className="font-semibold text-red-600 tabular-nums">{p.points}점</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default guarded(DashboardPage);
