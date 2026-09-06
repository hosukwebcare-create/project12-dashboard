import Link from "next/link";
import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCtx } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { addDays, toDateKey, todayKey } from "@/lib/rules/week";
import { formatHours } from "@/lib/rules/worklog";
import { saveWorkLogAction } from "@/modules/worklog/actions";
import { listShiftSlots, monthLogsForUser, myWorkLog } from "@/modules/worklog/repo";

export const metadata = { title: "근무일지" };

async function MyWorklogPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await getCtx();
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKey();
  const [slots, mine, monthLogs] = await Promise.all([listShiftSlots(ctx), myWorkLog(ctx, date), monthLogsForUser(ctx, ctx.userId, date.slice(0, 7))]);
  const dates = [-2, -1, 0].map((d) => toDateKey(addDays(todayKey(), d)));
  const dow = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))).getDay();
  const isWeekend = dow === 0 || dow === 6;
  const visibleSlots = slots.filter((s) => (isWeekend ? s.weekend : !s.weekend));
  const locked = Boolean(mine?.hqConfirmedAt);
  const totalX100 = monthLogs.reduce((a, l) => a + l.hoursX100 + l.overtimeX100, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader>
          <CardTitle>{fmtShortDate(date)} 근무 체크</CardTitle>
          <CardDescription>{slots.length === 0 ? "지점장이 아직 근무 타임을 설정하지 않았습니다." : locked ? "본사 확인이 완료되어 수정할 수 없습니다." : "근무한 타임을 체크하고 저장하세요. 초과근무는 시간과 사유를 함께 입력합니다."}</CardDescription>
          <div className="pill-nav mt-2">
            {(dates.includes(date) ? dates : [date, ...dates]).map((d) => (
              <Link key={d} href={`/worklog?date=${d}`} className="pill" data-active={d === date}>
                {fmtShortDate(d)}
              </Link>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <InlineForm action={saveWorkLogAction} className="flex-col items-stretch" submitLabel={locked ? "잠김" : "저장"}>
            <input type="hidden" name="date" value={date} />
            <fieldset disabled={locked} className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {visibleSlots.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <input type="checkbox" name="slot" value={s.key} defaultChecked={mine?.slotKeys.includes(s.key) ?? false} className="size-4" />
                    <span>
                      {s.label}
                      <span className="block text-[11px] text-muted-foreground">
                        {s.startTime}~{s.endTime} · {formatHours(s.hours)}h
                      </span>
                    </span>
                  </label>
                ))}
                {visibleSlots.length === 0 ? <p className="col-span-full text-sm text-muted-foreground">{isWeekend ? "주말" : "평일"} 타임이 없습니다</p> : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="overtime">초과근무 (시간)</Label>
                  <Input id="overtime" name="overtime" inputMode="decimal" defaultValue={mine ? formatHours(mine.overtimeX100) : ""} placeholder="예: 0.5" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="overtimeReason">초과근무 사유</Label>
                  <Input id="overtimeReason" name="overtimeReason" defaultValue={mine?.overtimeReason ?? ""} placeholder="예: 외출 확인, 남자 화장실 정리" />
                </div>
                <div className="space-y-1 sm:col-span-3">
                  <Label htmlFor="note">메모</Label>
                  <Input id="note" name="note" defaultValue={mine?.note ?? ""} />
                </div>
              </div>
            </fieldset>
            {mine ? (
              <p className="text-sm text-muted-foreground">
                저장된 근무시간 {formatHours(mine.hoursX100)}h + 초과 {formatHours(mine.overtimeX100)}h = <span className="font-semibold text-foreground">{formatHours(mine.hoursX100 + mine.overtimeX100)}h</span>
                {mine.hqConfirmedAt ? " · 본사 확인 완료" : ""}
              </p>
            ) : null}
          </InlineForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{date.slice(0, 7).replace("-", "년 ")}월 내 근무</CardTitle>
          <CardDescription>
            {monthLogs.length}일 · 합계 {formatHours(totalX100)}h
          </CardDescription>
        </CardHeader>
        <CardContent>
          {monthLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">기록 없음</p>
          ) : (
            <ul className="divide-y text-sm">
              {monthLogs.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-1.5">
                  <Link href={`/worklog?date=${l.date}`} className="hover:underline">
                    {fmtShortDate(l.date)}
                  </Link>
                  <span className="tabular-nums">
                    {formatHours(l.hoursX100)}h{l.overtimeX100 ? ` +${formatHours(l.overtimeX100)}` : ""}
                    {l.hqConfirmedAt ? <span className="ml-1 text-emerald-700">✓</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default guarded(MyWorklogPage);
