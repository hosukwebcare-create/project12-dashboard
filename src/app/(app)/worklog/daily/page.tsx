import Link from "next/link";
import { WorkDayGrid, type GridRow } from "@/components/app/work-day-grid";
import { getCtx, MANAGER_ROLES, requireRole } from "@/lib/auth/ctx";
import { fmtShortDate, fmtTime } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { addDays, toDate, toDateKey, todayKey } from "@/lib/rules/week";
import { patchStaffProfileAction, patchWorkLogAction, setWorkLogConfirmedAction } from "@/modules/worklog/actions";
import { listShiftSlots, workDay } from "@/modules/worklog/repo";

export const metadata = { title: "근무 일별 현황" };

async function DailyWorklogPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await getCtx();
  requireRole(ctx, ...MANAGER_ROLES);
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKey();
  const [day, slots] = await Promise.all([workDay(ctx, date), listShiftSlots(ctx, undefined, true)]);
  const dates = [-3, -2, -1, 0].map((d) => toDateKey(addDays(todayKey(), d)));
  const dow = toDate(date).getDay();
  const rows: GridRow[] = day.map((r) => ({
    userId: r.userId,
    name: r.name,
    role: r.role,
    employmentType: r.employmentType,
    workDays: r.workDays,
    group: r.group,
    former: r.former,
    logId: r.log?.id ?? null,
    slotKeys: r.log?.slotKeys ?? [],
    hoursX100: r.log?.hoursX100 ?? 0,
    overtimeX100: r.log?.overtimeX100 ?? 0,
    overtimeReason: r.log?.overtimeReason ?? null,
    note: r.log?.note ?? null,
    clock: r.log?.clockInAt ? `${fmtTime(r.log.clockInAt)}${r.log.clockOutAt ? ` ~ ${fmtTime(r.log.clockOutAt)}` : " · 근무 중"}` : null,
    confirmedBy: r.log?.hqConfirmedAt ? (r.hqConfirmedByName ?? "본사") : null,
  }));

  return (
    <div className="space-y-3">
      <div className="pill-nav">
        {(dates.includes(date) ? dates : [date, ...dates]).map((d) => (
          <Link key={d} href={`/worklog/daily?date=${d}`} className="pill" data-active={d === date}>
            {fmtShortDate(d)}
          </Link>
        ))}
      </div>
      <div>
        <h2 className="text-base font-semibold">{fmtShortDate(date)} 근무 현황</h2>
        <p className="text-sm text-muted-foreground">
          {dow === 0 ? "일요일이라 일1·일2타임이 나옵니다. " : ""}
          {ctx.role === "hq_admin" ? "본사 확인을 누르면 그 줄이 잠기고 월 집계의 확인 시간에 들어갑니다." : "본사 확인은 본사 관리자만 할 수 있습니다. 확인된 줄은 고칠 수 없습니다."}
        </p>
      </div>
      <WorkDayGrid
        key={date}
        date={date}
        sunday={dow === 0}
        rows={rows}
        slots={slots.map((s) => ({ key: s.key, label: s.label, audience: s.audience, weekend: s.weekend, minutes: s.minutes, hours: s.hours, startTime: s.startTime, endTime: s.endTime, active: s.active }))}
        isHq={ctx.role === "hq_admin"}
        patchLog={patchWorkLogAction}
        patchStaff={patchStaffProfileAction}
        confirm={setWorkLogConfirmedAction}
      />
      <p className="text-xs text-muted-foreground">
        타임의 이름·인정 시간(분)·시각은 자주 바꾸지 않아서 <Link href="/worklog/settings" className="underline underline-offset-2">타임·직원 설정</Link>에 있습니다. 시급은 <Link href="/worklog/monthly" className="underline underline-offset-2">월 집계</Link> 표에서 바로 고칩니다.
      </p>
    </div>
  );
}

export default guarded(DailyWorklogPage);
