import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AttentionList } from "@/components/app/attention-list";
import { IssueStatusBadge, SeverityBadge } from "@/components/app/issue-badges";
import { PageHeader } from "@/components/app/page-header";
import { RoundsStrip } from "@/components/app/rounds-strip";
import { StatCard } from "@/components/app/stat-card";
import { WorkClock } from "@/components/app/work-clock";
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

/**
 * 대시보드의 모든 블록은 같은 상자다: 얇은 머리줄(제목 · 오른쪽 보조) + 표.
 * 이 팀은 시트에서 넘어왔다. 카드 여러 장보다 작은 표 여러 개가 그들의 문법이다.
 */
function Panel({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-md bg-card ring-1 ring-border", className)}>
      <header className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-2">
        <h2 className="text-[13px] font-bold">{title}</h2>
        {aside ? <span className="text-xs text-muted-foreground">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">{children}</p>;
}

/** 패널 안의 표. 머리글은 회색 바탕, 행 32px */
const TH = "px-4 py-1.5 text-left text-[11px] font-medium whitespace-nowrap text-muted-foreground bg-muted/50";
const TD = "px-4 py-1.5 align-middle";

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
        <Panel title="전 지점 요약" aside="상단의 지점 선택으로 전환하면 아래 내용이 그 지점 기준으로 바뀝니다" className="mb-5">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>지점</th>
                  <th className={cn(TH, "text-right")}>등록 회원</th>
                  <th className={cn(TH, "text-right")}>오늘 라운딩</th>
                  <th className={cn(TH, "text-right")}>미해결 이슈</th>
                  <th className={cn(TH, "text-right")}>상담 미작성</th>
                  <th className={cn(TH, "text-right")}>주간 벌점(상위5 합)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {overview.map((b) => (
                  <tr key={b.branchId} className={cn(b.branchId === ctx.branchId && "bg-accent/30 font-semibold")}>
                    <td className={TD}>{b.branchName}</td>
                    <td className={cn(TD, "text-right")}>{b.enrolled}</td>
                    <td className={cn(TD, "text-right")}>
                      {b.sessionsDone}/{b.roundsPerDay}
                    </td>
                    <td className={cn(TD, "text-right")}>{b.openIssues}</td>
                    <td className={cn(TD, "text-right")}>{b.missingWeekly}</td>
                    <td className={cn(TD, "text-right")}>{b.weeklyPoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      {/* 왼쪽은 "무엇을 해야 하나", 오른쪽은 "나와 이번 주". 1280px 미만에서는 한 줄로 쌓인다 */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <AttentionList items={attention} />

          <div className="grid divide-y divide-border rounded-md bg-card ring-1 ring-border md:grid-cols-3 md:divide-x md:divide-y-0">
            <StatCard label="오늘 라운딩" value={d.sessionsDone} unit={`/ ${d.roundsPerDay} 회차`} href="/rounding/history" hint="회차별 결과 보기">
              <RoundsStrip days={d.recentRounds} perDay={d.roundsPerDay} />
            </StatCard>
            <StatCard label="이번 주 상담일지 미작성" value={d.missingWeekly} unit="명" tone={d.missingWeekly > 0 ? "warning" : "default"} href={`/counsel/weekly?week=${d.weekStart}`} hint={`${fmtShortDate(d.weekStart)} 주 상담일지 열기`} />
            <StatCard label="등록 만료 임박 (7일)" value={d.expiring.length} unit="명" tone={d.expiring.length > 0 ? "warning" : "default"} href="/members?tab=enrolled" hint="회원 목록 열기" />
          </div>

          <Panel
            title="미해결 이슈"
            aside={
              <Link href="/issues" className="hover:text-foreground hover:underline">
                {d.openIssues.length}건 · 이슈함 열기
              </Link>
            }
          >
            {d.openIssues.length === 0 ? (
              <Empty>미해결 이슈가 없습니다</Empty>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={cn(TH, "w-16")}>심각도</th>
                    <th className={TH}>제목</th>
                    <th className={cn(TH, "w-20")}>상태</th>
                    <th className={cn(TH, "w-20 text-right")}>등록</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.openIssues.map((i) => (
                    <tr key={i.id} className="hover:bg-accent/40">
                      <td className={TD}>
                        <SeverityBadge severity={i.severity} />
                      </td>
                      <td className={cn(TD, "font-medium")}>
                        <Link href={`/issues/${i.id}`} className="hover:underline">
                          {i.title}
                        </Link>
                      </td>
                      <td className={TD}>
                        <IssueStatusBadge status={i.status} />
                      </td>
                      <td className={cn(TD, "text-right text-xs whitespace-nowrap text-muted-foreground")}>{fmtRelative(i.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel
            title="다가오는 상담"
            aside={
              <Link href="/counsel/schedule" className="hover:text-foreground hover:underline">
                7일 · 일정표 열기
              </Link>
            }
          >
            {appointments.length === 0 ? (
              <Empty>7일 안에 잡힌 상담이 없습니다</Empty>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={cn(TH, "w-28")}>일시</th>
                    <th className={TH}>이름</th>
                    <th className={cn(TH, "w-24 text-right")}>담당</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {appointments.slice(0, 6).map((a) => (
                    <tr key={a.id} className="hover:bg-accent/40">
                      <td className={cn(TD, "whitespace-nowrap", a.date === today ? "font-semibold text-primary" : "text-muted-foreground")}>
                        {a.date === today ? "오늘" : fmtShortDate(a.date)} {a.startTime}
                      </td>
                      <td className={cn(TD, "font-medium")}>
                        <Link href={`/counsel/schedule?week=${a.date}&edit=${a.id}`} className="hover:underline">
                          {a.displayName}
                        </Link>
                      </td>
                      <td className={cn(TD, "text-right text-xs text-muted-foreground")}>{a.assigneeName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <aside className="min-w-0 space-y-5">
          {clock ? <WorkClock state={clock} clockIn={clockInAction} clockOut={clockOutAction} compact /> : null}

          {money ? (
            <Panel
              title="받아야 할 돈"
              aside={
                <Link href="/payments" className="hover:text-foreground hover:underline">
                  결제 대상 열기
                </Link>
              }
            >
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={TH}>구분</th>
                    <th className={cn(TH, "text-right")}>건수</th>
                    <th className={cn(TH, "text-right")}>금액</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className={TD}>좌석 이용료</td>
                    <td className={cn(TD, "text-right")}>{money.seat.pending}건</td>
                    <td className={cn(TD, "text-right")}>{won(money.seat.amount)}</td>
                  </tr>
                  <tr>
                    <td className={TD}>식사비</td>
                    <td className={cn(TD, "text-right")}>{money.meal.pending}명</td>
                    <td className={cn(TD, "text-right")}>{won(money.meal.amount)}</td>
                  </tr>
                  <tr className="bg-muted/30 font-semibold">
                    <td className={TD}>합계</td>
                    <td className={cn(TD, "text-right")}>{money.seat.pending + money.meal.pending}건</td>
                    <td className={cn(TD, "text-right text-primary")}>{won(money.total)}원</td>
                  </tr>
                </tbody>
              </table>
              {money.unpriced > 0 ? <p className="border-t border-border px-4 py-2 text-xs text-warning">금액 미정 {money.unpriced}건 · 좌석 등급을 지정해야 청구액이 잡힙니다</p> : null}
            </Panel>
          ) : null}

          <Panel title="등록 만료 임박" aside="7일 안">
            {d.expiring.length === 0 ? (
              <Empty>이번 주 만료 예정이 없습니다</Empty>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={cn(TH, "w-12 text-right")}>좌석</th>
                    <th className={TH}>이름</th>
                    <th className={cn(TH, "text-right")}>종료일</th>
                    <th className={cn(TH, "w-14 text-right")}>남은</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.expiring.slice(0, 6).map((e) => (
                    <tr key={e.memberId} className="hover:bg-accent/40">
                      <td className={cn(TD, "text-right text-muted-foreground")}>{e.seatNo ?? "-"}</td>
                      <td className={cn(TD, "font-medium")}>
                        <Link href={`/members/${e.memberId}`} className="hover:underline">
                          {e.name}
                        </Link>
                      </td>
                      <td className={cn(TD, "text-right whitespace-nowrap text-muted-foreground")}>{fmtDate(e.endDate)}</td>
                      <td className={cn(TD, "text-right", e.daysLeft <= 3 ? "font-semibold text-destructive" : "")}>{e.daysLeft}일</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="벌점 상위" aside="이번 주">
            {d.topPenalties.length === 0 ? (
              <Empty>이번 주 벌점이 없습니다</Empty>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={cn(TH, "w-10")}>#</th>
                    <th className={cn(TH, "w-12 text-right")}>좌석</th>
                    <th className={TH}>이름</th>
                    <th className={cn(TH, "text-right")}>벌점</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.topPenalties.map((p, i) => (
                    <tr key={p.memberId} className="hover:bg-accent/40">
                      <td className={cn(TD, "text-muted-foreground")}>{i + 1}</td>
                      <td className={cn(TD, "text-right text-muted-foreground")}>{p.seatNo ?? "-"}</td>
                      <td className={cn(TD, "font-medium")}>
                        <Link href={`/members/${p.memberId}`} className="hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td className={cn(TD, "text-right font-semibold text-destructive")}>{p.points}점</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {unreadNotes > 0 ? (
            <Link href="/handover" className="flex items-center justify-between rounded-md bg-card px-4 py-2.5 text-sm ring-1 ring-border transition-colors hover:bg-accent/40">
              <span className="font-medium">인수인계 안 읽은 글 {unreadNotes}건</span>
              <span className="text-xs text-muted-foreground">인수인계 ›</span>
            </Link>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

export default guarded(DashboardPage);
