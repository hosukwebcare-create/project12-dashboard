import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCtx, MANAGER_ROLES, requireRole, ROLE_LABEL } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { formatHours } from "@/lib/rules/worklog";
import { upsertShiftSlotAction, upsertStaffProfileAction } from "@/modules/worklog/actions";
import { EMPLOYMENT_TYPES, listShiftSlots, listStaff } from "@/modules/worklog/repo";

export const metadata = { title: "근무 설정" };

const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

async function WorklogSettingsPage() {
  const ctx = await getCtx();
  requireRole(ctx, ...MANAGER_ROLES);
  const [slots, staff] = await Promise.all([listShiftSlots(ctx, undefined, true), listStaff(ctx)]);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>근무 타임</CardTitle>
          <CardDescription>시트의 1~7타임·일1/일2타임에 해당합니다. 인정 시간은 타임을 체크했을 때 더해지는 시간입니다.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {slots.map((s) => (
            <InlineForm key={s.id} action={upsertShiftSlotAction} className="py-2">
              <input type="hidden" name="id" value={s.id} />
              <Input name="key" defaultValue={s.key} className="w-20" aria-label="키" />
              <Input name="label" defaultValue={s.label} className="w-28" aria-label="이름" />
              <Input name="startTime" type="time" defaultValue={s.startTime} className="w-32" aria-label="시작" />
              <Input name="endTime" type="time" defaultValue={s.endTime} className="w-32" aria-label="종료" />
              <Input name="hours" defaultValue={formatHours(s.hours)} className="w-20" aria-label="인정 시간" />
              <Input name="sort" type="number" defaultValue={s.sort} className="w-16" aria-label="순서" />
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="weekend" defaultChecked={s.weekend} className="size-4" /> 주말
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="active" defaultChecked={s.active} className="size-4" /> 사용
              </label>
            </InlineForm>
          ))}
          <div className="pt-3">
            <p className="mb-1 text-xs text-muted-foreground">새 타임</p>
            <InlineForm action={upsertShiftSlotAction} submitLabel="추가">
              <input type="hidden" name="active" value="true" />
              <Input name="key" placeholder="키 (t1)" className="w-20" required />
              <Input name="label" placeholder="이름 (1타임)" className="w-28" required />
              <Input name="startTime" type="time" className="w-32" required aria-label="시작" />
              <Input name="endTime" type="time" className="w-32" required aria-label="종료" />
              <Input name="hours" placeholder="시간 (0.5)" className="w-24" required />
              <Input name="sort" type="number" defaultValue={slots.length + 1} className="w-16" />
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="weekend" className="size-4" /> 주말
              </label>
            </InlineForm>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>직원 근무 정보</CardTitle>
          <CardDescription>근무 형태·시급·근무 요일. 시급은 월 집계의 예상 급여 계산에만 쓰이며 급여 확정은 담당자가 합니다.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {staff.map((s) => (
            <InlineForm key={s.userId} action={upsertStaffProfileAction} className="py-2">
              <input type="hidden" name="userId" value={s.userId} />
              <span className="w-24 text-sm font-medium">
                {s.name}
                <span className="block text-[11px] font-normal text-muted-foreground">{ROLE_LABEL[s.role as keyof typeof ROLE_LABEL] ?? s.role}</span>
              </span>
              <select name="employmentType" defaultValue={s.employmentType} className={selectClass} aria-label="근무 형태">
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <Input name="hourlyRate" type="number" min={0} step={10} defaultValue={s.hourlyRate ?? ""} placeholder="시급" className="w-28" />
              <Input name="workDays" defaultValue={s.workDays ?? ""} placeholder="근무요일 (월~수)" className="w-32" />
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="direct" defaultChecked={s.direct} className="size-4" /> 직영
              </label>
            </InlineForm>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default guarded(WorklogSettingsPage);
