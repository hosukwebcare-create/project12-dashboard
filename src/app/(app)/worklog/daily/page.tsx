import Link from "next/link";
import { InlineForm } from "@/components/app/inline-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCtx, MANAGER_ROLES, requireRole } from "@/lib/auth/ctx";
import { fmtDateTime, fmtShortDate, fmtTime } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { addDays, toDateKey, todayKey } from "@/lib/rules/week";
import { formatHours } from "@/lib/rules/worklog";
import { confirmWorkLogAction, saveWorkLogAction } from "@/modules/worklog/actions";
import { dailyWorkLogs, listShiftSlots, listStaff } from "@/modules/worklog/repo";

export const metadata = { title: "근무 일별 현황" };

async function DailyWorklogPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await getCtx();
  requireRole(ctx, ...MANAGER_ROLES);
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKey();
  const [rows, slots, staff] = await Promise.all([dailyWorkLogs(ctx, date), listShiftSlots(ctx), listStaff(ctx)]);
  const dates = [-3, -2, -1, 0].map((d) => toDateKey(addDays(todayKey(), d)));
  const slotLabel = new Map(slots.map((s) => [s.key, s.label]));
  const isHq = ctx.role === "hq_admin";

  return (
    <div className="space-y-4">
      <div className="pill-nav">
        {(dates.includes(date) ? dates : [date, ...dates]).map((d) => (
          <Link key={d} href={`/worklog/daily?date=${d}`} className="pill" data-active={d === date}>
            {fmtShortDate(d)}
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{fmtShortDate(date)} 근무 현황</CardTitle>
          <CardDescription>{isHq ? "본사 확인을 누르면 해당 기록이 잠기고 월 집계의 확인 시간에 포함됩니다." : "본사 확인은 본사 관리자만 할 수 있습니다."}</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">기록이 없습니다</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">근무자</th>
                  <th className="py-1">형태</th>
                  <th className="py-1">출퇴근</th>
                  <th className="py-1">타임</th>
                  <th className="py-1 text-right">근무</th>
                  <th className="py-1 text-right">초과</th>
                  <th className="py-1">사유·메모</th>
                  <th className="py-1">본사 확인</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-1.5 font-medium">{r.userName}</td>
                    <td className="py-1.5">{r.employmentType}</td>
                    <td className="py-1.5 whitespace-nowrap tabular-nums">
                      {r.clockInAt ? (
                        <>
                          {fmtTime(r.clockInAt)}
                          {r.clockOutAt ? ` ~ ${fmtTime(r.clockOutAt)}` : <span className="ml-1 text-xs font-medium text-primary">근무 중</span>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="py-1.5">{r.slotKeys.map((k) => slotLabel.get(k) ?? k).join(", ") || "-"}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatHours(r.hoursX100)}h</td>
                    <td className="py-1.5 text-right tabular-nums">{r.overtimeX100 ? `${formatHours(r.overtimeX100)}h` : ""}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">
                      {r.overtimeReason ?? ""}
                      {r.note ? ` · ${r.note}` : ""}
                    </td>
                    <td className="py-1.5">
                      {r.hqConfirmedAt ? (
                        <span className="text-xs text-emerald-700">
                          {r.hqConfirmedByName ?? "본사"} · {fmtDateTime(r.hqConfirmedAt)}
                          {isHq ? (
                            <form action={confirmWorkLogAction} className="inline">
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="undo" value="1" />
                              <Button type="submit" size="xs" variant="ghost" className="ml-1">
                                취소
                              </Button>
                            </form>
                          ) : null}
                        </span>
                      ) : isHq ? (
                        <form action={confirmWorkLogAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <Button type="submit" size="xs" variant="outline">
                            확인
                          </Button>
                        </form>
                      ) : (
                        <span className="text-xs text-muted-foreground">미확인</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>대리 입력</CardTitle>
          <CardDescription>직원이 체크를 놓쳤을 때 지점장이 대신 입력합니다. 감사 로그에 남습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <InlineForm action={saveWorkLogAction} submitLabel="저장">
            <input type="hidden" name="date" value={date} />
            <select name="userId" className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="근무자">
              {staff.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name} ({s.employmentType})
                </option>
              ))}
            </select>
            {slots.map((s) => (
              <label key={s.id} className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="slot" value={s.key} className="size-4" /> {s.label}
              </label>
            ))}
            <Input name="overtime" placeholder="초과(시간)" className="w-24" />
            <Input name="overtimeReason" placeholder="초과 사유" className="w-40" />
            <Input name="note" placeholder="메모" className="w-32" />
          </InlineForm>
        </CardContent>
      </Card>
    </div>
  );
}

export default guarded(DailyWorklogPage);
