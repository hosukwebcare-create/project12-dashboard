import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCtx, MANAGER_ROLES, requireRole, ROLE_LABEL } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { formatHours, GROUP_SLOT_PRESET, STAFF_GROUP_LABEL, STAFF_GROUPS } from "@/lib/rules/worklog";
import { applyGroupSlotPresetAction, upsertShiftSlotAction, upsertStaffProfileAction } from "@/modules/worklog/actions";
import { EMPLOYMENT_TYPES, listShiftSlots, listStaff } from "@/modules/worklog/repo";

export const metadata = { title: "근무 설정" };

const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

async function WorklogSettingsPage() {
  const ctx = await getCtx();
  requireRole(ctx, ...MANAGER_ROLES);
  const [slots, staff] = await Promise.all([listShiftSlots(ctx, undefined, true), listStaff(ctx)]);
  const hasGroupSlots = slots.some((s) => s.audience !== null);
  // 직군별로 나눠 보여준다: 조교 · 원장 · 멘토 · 공통(직군 없음)
  const sections = [...STAFF_GROUPS.map((g) => ({ key: g.key as string, label: g.label, slots: slots.filter((s) => s.audience === g.key) })), { key: "all", label: "공통", slots: slots.filter((s) => s.audience === null) }].filter((g) => g.slots.length > 0);
  const audienceSelect = (defaultValue: string) => (
    <select name="audience" defaultValue={defaultValue} className={selectClass} aria-label="직군">
      <option value="">공통</option>
      {STAFF_GROUPS.map((g) => (
        <option key={g.key} value={g.key}>
          {g.label}
        </option>
      ))}
    </select>
  );
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>근무 타임</CardTitle>
          <CardDescription>직군을 정한 타임은 그 직군 직원의 근무 체크에만 보이고, 공통 타임은 모두에게 보입니다. 인정 시간은 타임을 체크했을 때 더해지는 시간입니다.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {!hasGroupSlots ? (
            <div className="pb-3">
              <p className="mb-2 text-sm">
                아직 직군별 타임이 없습니다. 기본값을 넣으면 {GROUP_SLOT_PRESET.map((p) => `${STAFF_GROUP_LABEL[p.audience]} ${p.startTime}~${p.endTime}`).join(", ")} 세 타임이 생기고, 지금 쓰는 평일 공통 타임은 &lsquo;사용 안 함&rsquo;으로 바뀝니다. 지난 근무 기록과 시간은 그대로이며, 넣은 뒤에 시각과 인정 시간을 고칠 수 있습니다.
              </p>
              <InlineForm action={applyGroupSlotPresetAction} submitLabel="직군별 기본 타임 넣기" />
            </div>
          ) : null}
          {sections.map((sec) => (
            <div key={sec.key} className="py-2">
              <p className="text-xs font-semibold">{sec.label}</p>
          {sec.slots.map((s) => (
            <InlineForm key={s.id} action={upsertShiftSlotAction} className="py-2">
              <input type="hidden" name="id" value={s.id} />
              <Input name="key" defaultValue={s.key} className="w-20" aria-label="키" />
              <Input name="label" defaultValue={s.label} className="w-28" aria-label="이름" />
              <Input name="startTime" type="time" defaultValue={s.startTime} className="w-32" aria-label="시작" />
              <Input name="endTime" type="time" defaultValue={s.endTime} className="w-32" aria-label="종료" />
              <Input name="hours" defaultValue={formatHours(s.hours)} className="w-20" aria-label="인정 시간" />
              <Input name="sort" type="number" defaultValue={s.sort} className="w-16" aria-label="순서" />
              {audienceSelect(s.audience ?? "")}
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="weekend" defaultChecked={s.weekend} className="size-4" /> 주말
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="active" defaultChecked={s.active} className="size-4" /> 사용
              </label>
            </InlineForm>
          ))}
            </div>
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
              {audienceSelect("")}
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
          <CardDescription>근무 형태·시급·근무 요일·하루 근무 예정 시간. 시급은 월 집계의 예상 급여 계산에만 쓰이며 급여 확정은 담당자가 합니다. 하루 예정 시간은 출퇴근 링이 한 바퀴 도는 기준이고 비워 두면 8시간, 주 소정근로시간은 이번 주 막대의 기준이고 비워 두면 하루 예정 × 5 로 봅니다.</CardDescription>
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
              <Input name="targetHours" defaultValue={s.targetHoursX100 !== null ? formatHours(s.targetHoursX100) : ""} placeholder="하루 8" className="w-20" aria-label="하루 근무 예정 시간" />
              <Input name="weeklyTargetHours" defaultValue={s.weeklyTargetHoursX100 !== null ? formatHours(s.weeklyTargetHoursX100) : ""} placeholder="주 40" className="w-20" aria-label="주 소정근로시간" />
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
