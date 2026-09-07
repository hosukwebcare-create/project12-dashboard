import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { AppointmentForm } from "@/components/app/appointment-form";
import { InlineForm } from "@/components/app/inline-form";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCtx, MANAGER_ROLES } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { addDays, toDateKey, todayKey, weekStart } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import { deleteAppointmentAction, upsertAppointmentAction } from "@/modules/schedule/actions";
import { APPOINTMENT_KINDS, APPOINTMENT_STATUSES, bandOf, KIND_LABEL, schedulePickers, STATUS_LABEL, TIME_BANDS, weekAppointments, type AppointmentRow, type BandKey } from "@/modules/schedule/repo";

export const metadata = { title: "상담 일정" };

const DOW = ["월", "화", "수", "목", "금", "토", "일"];

const KIND_DOT: Record<string, string> = { new: "bg-primary", member: "bg-emerald-500", guardian: "bg-violet-500" };
const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-card ring-border",
  done: "bg-emerald-50/70 ring-emerald-200",
  canceled: "bg-muted text-muted-foreground line-through ring-border",
  noshow: "bg-rose-50/70 ring-rose-200",
};

function Slot({ a }: { a: AppointmentRow }) {
  return (
    <Link
      href={`/counsel/schedule?week=${a.date}&edit=${a.id}`}
      className={cn("block rounded-md px-1.5 py-1 text-[11px] leading-snug ring-1 transition-colors hover:ring-primary", STATUS_STYLE[a.status])}
    >
      <span className="flex items-center gap-1">
        <span className={cn("size-1.5 shrink-0 rounded-full", KIND_DOT[a.kind])} aria-hidden />
        <span className="font-semibold tabular-nums">{a.startTime}</span>
        <span className="truncate font-medium">{a.displayName}</span>
      </span>
      {a.assigneeName ? <span className="block truncate text-muted-foreground">{a.assigneeName}</span> : null}
    </Link>
  );
}

type Search = { week?: string; edit?: string; new?: string };

async function SchedulePage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await getCtx();
  const sp = await searchParams;
  const base = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : todayKey();
  const { days, rows } = await weekAppointments(ctx, base);
  const { members, staff } = await schedulePickers(ctx);
  const editing = sp.edit ? rows.find((r) => r.id === sp.edit) : undefined;
  const today = todayKey();

  const ws = toDateKey(weekStart(base));
  const prev = toDateKey(addDays(ws, -7));
  const next = toDateKey(addDays(ws, 7));

  // 시간대 × 요일 격자에 흩뿌린다. 어느 구간에도 안 맞는 시각은 '그 밖' 줄로
  const cell = new Map<string, AppointmentRow[]>();
  for (const r of rows) {
    const key = `${bandOf(r.startTime)}|${r.date}`;
    cell.set(key, [...(cell.get(key) ?? []), r]);
  }
  const bands: { key: BandKey; label: string }[] = [...TIME_BANDS.map((b) => ({ key: b.key as BandKey, label: b.label }))];
  if (rows.some((r) => bandOf(r.startTime) === "etc")) bands.push({ key: "etc", label: "그 밖" });

  const draft = editing
    ? { id: editing.id, date: editing.date, startTime: editing.startTime, endTime: editing.endTime, kind: editing.kind, memberId: editing.memberId, personName: editing.personName, personPhone: editing.personPhone, assignedTo: editing.assignedTo, note: editing.note, status: editing.status }
    : { date: sp.new && /^\d{4}-\d{2}-\d{2}$/.test(sp.new) ? sp.new : today, startTime: "14:00", kind: "new" as const };

  return (
    <div className="space-y-5">
      <PageHeader
        title="상담 일정"
        description={`${ctx.branchName} · ${fmtShortDate(days[0])} ~ ${fmtShortDate(days[6])}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/counsel/schedule?week=${prev}`} aria-label="이전 주">
                <ChevronLeft />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/counsel/schedule?week=${next}`} aria-label="다음 주">
                <ChevronRight />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/counsel/schedule">이번 주</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/counsel/weekly">주간 상담일지</Link>
            </Button>
          </>
        }
      />

      <div className="overflow-x-auto rounded-lg bg-card ring-1 ring-border">
        <table className="w-full min-w-[64rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/60 text-xs text-muted-foreground">
              <th className="w-28 px-3 py-2 text-left font-medium">시간</th>
              {days.map((d, i) => (
                <th key={d} className={cn("px-2 py-2 text-left font-medium", d === today && "text-primary")}>
                  {fmtShortDate(d).replace(/\(.\)/, "")} {DOW[i]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b.key} className="border-b border-border last:border-b-0">
                <th className="px-3 py-2 text-left align-top text-xs font-medium whitespace-nowrap text-muted-foreground">{b.label}</th>
                {days.map((d) => {
                  const list = cell.get(`${b.key}|${d}`) ?? [];
                  return (
                    <td key={d} className={cn("min-w-32 border-l border-border px-1.5 py-1.5 align-top", d === today && "bg-accent/30")}>
                      <div className="flex flex-col gap-1">
                        {list.map((a) => (
                          <Slot key={a.id} a={a} />
                        ))}
                        <Link
                          href={`/counsel/schedule?week=${base}&new=${d}`}
                          className="rounded-md px-1.5 py-1 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 md:opacity-0 md:hover:opacity-100"
                          aria-label={`${d} 일정 추가`}
                        >
                          + 추가
                        </Link>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{editing ? "일정 수정" : "일정 추가"}</CardTitle>
            <CardDescription>
              {editing ? `${editing.date} ${editing.startTime} · ${KIND_LABEL[editing.kind]}` : "신규 상담은 이름만으로, 재상담은 회원을 골라 잡습니다."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <AppointmentForm
              key={editing?.id ?? draft.date}
              action={upsertAppointmentAction}
              draft={draft}
              members={members}
              staff={staff}
              kinds={APPOINTMENT_KINDS}
              statuses={APPOINTMENT_STATUSES}
              submitLabel={editing ? "저장" : "추가"}
            />
            {editing ? (
              <div className="flex items-center gap-2 border-t border-border pt-3">
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/counsel/schedule?week=${base}`}>새 일정 쓰기</Link>
                </Button>
                {MANAGER_ROLES.includes(ctx.role) ? (
                  <InlineForm action={deleteAppointmentAction} submitLabel="삭제">
                    <input type="hidden" name="id" value={editing.id} />
                  </InlineForm>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>이번 주 목록 ({rows.length})</CardTitle>
            <CardDescription>격자에서 안 보이는 메모까지 한눈에 봅니다.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">이번 주 상담 일정이 없습니다</p>
            ) : (
              rows.map((a) => (
                <div key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="tabular-nums">
                    {fmtShortDate(a.date)} {a.startTime}
                    {a.endTime ? `~${a.endTime}` : ""}
                  </span>
                  <Link href={`/counsel/schedule?week=${a.date}&edit=${a.id}`} className="font-medium hover:underline">
                    {a.displayName}
                  </Link>
                  <span className="text-xs text-muted-foreground">{KIND_LABEL[a.kind]}</span>
                  {a.assigneeName ? <span className="text-xs text-muted-foreground">담당 {a.assigneeName}</span> : null}
                  <span className={cn("text-xs", a.status === "scheduled" ? "text-muted-foreground" : a.status === "done" ? "text-emerald-700" : "text-rose-700")}>{STATUS_LABEL[a.status]}</span>
                  {a.personPhone ? <span className="text-xs text-muted-foreground tabular-nums">{a.personPhone}</span> : null}
                  {a.note ? <span className="basis-full text-xs text-muted-foreground">{a.note}</span> : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default guarded(SchedulePage);
