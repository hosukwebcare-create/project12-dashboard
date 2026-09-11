import Link from "next/link";
import { redirect } from "next/navigation";
import { AttentionList } from "@/components/app/attention-list";
import { IssueStatusBadge, SeverityBadge } from "@/components/app/issue-badges";
import { PageHeader } from "@/components/app/page-header";
import { RoundsStrip } from "@/components/app/rounds-strip";
import { StatCard } from "@/components/app/stat-card";
import { WorkClock } from "@/components/app/work-clock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCtx, ROLE_LABEL } from "@/lib/auth/ctx";
import { fmtDate, fmtRelative, fmtShortDate } from "@/lib/format";
import { buildAttention } from "@/lib/rules/attention";
import { todayKey } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import { dashboard, hqOverview } from "@/modules/dashboard/repo";
import { unreadNoteCount } from "@/modules/handover/repo";
import { paymentSummary } from "@/modules/payments/repo";
import { upcomingAppointments } from "@/modules/schedule/repo";
import { clockInAction, clockOutAction } from "@/modules/worklog/actions";
import { myWorkClock } from "@/modules/worklog/repo";
import { guarded } from "@/lib/page-guard";

/** 빈 목록 자리. 점선 상자 대신 한 줄로 조용히 */
function Empty({ children }: { children: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function SectionTitle({ children, aside }: { children: string; aside?: React.ReactNode }) {
  return (
    <h2 className="mb-2 flex items-baseline justify-between text-sm font-semibold">
      {children}
      {aside ? <span className="text-xs font-normal text-muted-foreground">{aside}</span> : null}
    </h2>
  );
}

async function DashboardPage() {
  const ctx = await getCtx();
  if (ctx.role === "assistant") redirect("/rounding");
  const today = todayKey();
  const canSeeMoney = ctx.role === "hq_admin" || ctx.role === "branch_manager";
  const [d, overview, money, appointments, unreadNotes, clock] = await Promise.all([
    dashboard(ctx, today),
    ctx.isHqAdmin ? hqOverview(ctx, today) : Promise.resolve(null),
    canSeeMoney ? paymentSummary(ctx, today) : Promise.resolve(null),
    upcomingAppointments(ctx, 7, today),
    unreadNoteCount(ctx, 14, today),
    myWorkClock(ctx, today), // 지점 소속이 아니면 null 이라 카드가 뜨지 않는다
  ]);
  const won = (n: number) => n.toLocaleString("ko-KR");
  const nowTime = new Date().toTimeString().slice(0, 5);
  const attention = buildAttention({
    nowTime,
    sessionsDone: d.sessionsDone,
    roundsPerDay: d.roundsPerDay,
    roundSchedule: ctx.settings.roundSchedule ?? [],
    missingWeekly: d.missingWeekly,
    weekStart: d.weekStart,
    expiring: d.expiring,
    openIssues: d.openIssues,
    money: money ? { pending: money.seat.pending + money.meal.pending, amount: money.total, unpriced: money.unpriced } : null,
    unreadNotes,
    todayAppointments: appointments.filter((a) => a.date === today),
  });

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
                      <td className="py-2 pr-3 text-right tabular-nums">{b.enrolled}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {b.sessionsDone}/{b.roundsPerDay}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{b.openIssues}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{b.missingWeekly}</td>
                      <td className="py-2 text-right tabular-nums">{b.weeklyPoints}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">상단의 지점 선택으로 전환하면 아래 내용이 그 지점 기준으로 바뀝니다.</p>
          </CardContent>
        </Card>
      ) : null}

      {/* 왼쪽은 "무엇을 해야 하나", 오른쪽은 "나와 이번 주". 1280px 미만에서는 한 줄로 쌓인다 */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-8">
          <AttentionList items={attention} />

          <div className="grid gap-6 border-b border-border pb-6 md:grid-cols-3 md:gap-0">
            <StatCard label="오늘 라운딩" value={d.sessionsDone} unit={`/ ${d.roundsPerDay} 회차`} href="/rounding/history" hint="회차별 결과 보기">
              <RoundsStrip days={d.recentRounds} perDay={d.roundsPerDay} />
            </StatCard>
            <StatCard label="이번 주 상담일지 미작성" value={d.missingWeekly} unit="명" tone={d.missingWeekly > 0 ? "warning" : "default"} href={`/counsel/weekly?week=${d.weekStart}`} hint={`${fmtShortDate(d.weekStart)} 주 상담일지 열기`} />
            <StatCard label="등록 만료 임박 (7일)" value={d.expiring.length} unit="명" tone={d.expiring.length > 0 ? "warning" : "default"}>
              {d.expiring.length ? (
                <ul className="space-y-1 text-[13px]">
                  {d.expiring.slice(0, 4).map((e) => (
                    <li key={e.memberId} className="flex justify-between gap-2">
                      <Link href={`/members/${e.memberId}`} className="truncate hover:underline">
                        {e.seatNo ?? "-"}번 {e.name}
                      </Link>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
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

          <section>
            <SectionTitle aside={`${d.openIssues.length}건`}>미해결 이슈</SectionTitle>
            {d.openIssues.length === 0 ? (
              <Empty>미해결 이슈가 없습니다</Empty>
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
            <Link href="/issues" className="mt-2 inline-block text-[13px] text-muted-foreground hover:text-foreground hover:underline">
              이슈함 전체 보기
            </Link>
          </section>

          <section>
            <SectionTitle
              aside={
                <Link href="/counsel/schedule" className="hover:text-foreground hover:underline">
                  일정표
                </Link>
              }
            >
              다가오는 상담
            </SectionTitle>
            {appointments.length === 0 ? (
              <Empty>7일 안에 잡힌 상담이 없습니다</Empty>
            ) : (
              <ul className="divide-y divide-border border-y border-border text-sm">
                {appointments.slice(0, 6).map((a) => (
                  <li key={a.id} className="flex items-center gap-2 py-2">
                    <span className={cn("w-24 shrink-0 text-xs tabular-nums", a.date === today ? "font-semibold text-primary" : "text-muted-foreground")}>
                      {a.date === today ? "오늘" : fmtShortDate(a.date)} {a.startTime}
                    </span>
                    <Link href={`/counsel/schedule?week=${a.date}&edit=${a.id}`} className="flex-1 truncate font-medium hover:underline">
                      {a.displayName}
                    </Link>
                    {a.assigneeName ? <span className="shrink-0 text-xs text-muted-foreground">{a.assigneeName}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          {clock ? <WorkClock state={clock} clockIn={clockInAction} clockOut={clockOutAction} compact /> : null}

          {money ? (
            <Link href="/payments" className="block rounded-lg bg-card px-5 py-4 ring-1 ring-border transition-colors hover:ring-primary">
              <span className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">받아야 할 돈</span>
                <span className="text-xs text-muted-foreground">결제 대상 열기</span>
              </span>
              <span className="mt-2 block text-[28px] leading-none font-semibold tracking-tight text-primary tabular-nums">
                {won(money.total)}
                <span className="ml-1 text-sm font-normal text-muted-foreground">원</span>
              </span>
              <span className="mt-3 grid grid-cols-2 gap-x-4 text-sm">
                <span className="text-muted-foreground">
                  좌석 <b className="font-medium text-foreground tabular-nums">{won(money.seat.amount)}</b>
                  <span className="text-xs"> · {money.seat.pending}건</span>
                </span>
                <span className="text-muted-foreground">
                  식사 <b className="font-medium text-foreground tabular-nums">{won(money.meal.amount)}</b>
                  <span className="text-xs"> · {money.meal.pending}명</span>
                </span>
              </span>
              {money.unpriced > 0 ? <span className="mt-2 block text-xs text-warning">금액 미정 {money.unpriced}건 · 좌석 등급 지정 필요</span> : null}
            </Link>
          ) : null}

          <section>
            <SectionTitle aside="이번 주">벌점 상위</SectionTitle>
            {d.topPenalties.length === 0 ? (
              <Empty>이번 주 벌점이 없습니다</Empty>
            ) : (
              <ol className="divide-y divide-border border-y border-border text-sm">
                {d.topPenalties.map((p, i) => (
                  <li key={p.memberId} className="flex items-center gap-3 py-2">
                    <span className="w-4 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                    <Link href={`/members/${p.memberId}`} className="flex-1 truncate hover:underline">
                      <span className="text-muted-foreground">{p.seatNo ?? "-"}번</span> {p.name}
                    </Link>
                    <span className="font-medium text-destructive tabular-nums">{p.points}점</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {unreadNotes > 0 ? (
            <Link href="/handover" className="flex items-center gap-2 rounded-lg bg-primary/8 px-4 py-3 text-sm ring-1 ring-primary/25 transition-colors hover:ring-primary">
              <span className="font-medium text-primary">인수인계 안 읽은 글 {unreadNotes}건</span>
              <span className="ml-auto text-xs text-muted-foreground">읽으러 가기</span>
            </Link>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

export default guarded(DashboardPage);
