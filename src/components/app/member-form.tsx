"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionState } from "@/lib/action-utils";
import type { MemberDetail, SeatOccupancy } from "@/modules/members/repo";
import { MEMBER_STATUSES, STATUS_LABEL, STUDENT_TYPES, TRACKS } from "@/modules/members/schema";
import type { CustomFieldDef } from "@/modules/settings/repo";
import { CustomFields } from "./custom-fields";

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  seats: SeatOccupancy[];
  member?: MemberDetail;
  submitLabel: string;
  customFields?: CustomFieldDef[];
};

const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";

export function MemberForm({ action, seats, member, submitLabel, customFields = [] }: Props) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const g = member?.guardians[0];
  const e = member?.enrollments[0];

  return (
    <form action={formAction} className="space-y-4">
      {member ? <input type="hidden" name="id" value={member.id} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="name" label="이름" required>
            <Input id="name" name="name" defaultValue={member?.name ?? ""} required maxLength={30} />
          </Field>
          <Field id="gender" label="성별">
            <select id="gender" name="gender" defaultValue={member?.gender ?? ""} className={selectClass}>
              <option value="">선택</option>
              <option value="남">남</option>
              <option value="여">여</option>
            </select>
          </Field>
          <Field id="birthDate" label="생년월일">
            <Input id="birthDate" name="birthDate" type="date" defaultValue={member?.birthDate ?? ""} />
          </Field>
          <Field id="memberKind" label="구분">
            <select id="memberKind" name="memberKind" defaultValue={member?.memberKind ?? "student"} className={selectClass}>
              <option value="student">학생</option>
              <option value="adult">성인</option>
            </select>
          </Field>
          <Field id="studentType" label="TYPE">
            <select id="studentType" name="studentType" defaultValue={member?.studentType ?? ""} className={selectClass}>
              <option value="">선택</option>
              {STUDENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field id="track" label="계열">
            <select id="track" name="track" defaultValue={member?.track ?? ""} className={selectClass}>
              <option value="">선택</option>
              {TRACKS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field id="school" label="학교">
            <Input id="school" name="school" defaultValue={member?.school ?? ""} />
          </Field>
          <Field id="grade" label="학년">
            <Input id="grade" name="grade" defaultValue={member?.grade ?? ""} placeholder="예: 3" />
          </Field>
          <Field id="target" label="목표 대학·학과·시험">
            <Input id="target" name="target" defaultValue={member?.target ?? ""} />
          </Field>
          <Field id="fieldNote" label="라운딩 특이사항" hint="라운딩 목록에 항상 표시됩니다">
            <Input id="fieldNote" name="fieldNote" defaultValue={member?.fieldNote ?? ""} maxLength={100} placeholder="예: 매주 화 17시 학원 조퇴" />
          </Field>
          <div className="flex items-center gap-2 pt-6">
            <input id="focusCare" name="focusCare" type="checkbox" defaultChecked={member?.focusCare ?? false} className="size-4" />
            <Label htmlFor="focusCare">집중관리 대상</Label>
          </div>
          <Field id="memo" label="메모" className="sm:col-span-2 lg:col-span-3">
            <Textarea id="memo" name="memo" defaultValue={member?.memo ?? ""} rows={3} />
          </Field>
          {customFields.length ? <CustomFields defs={customFields} values={member?.custom ?? {}} className="sm:col-span-2 lg:col-span-3" /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>연락처 · 학부모</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="phone" label="연락처">
            <Input id="phone" name="phone" defaultValue={member?.phone ?? ""} placeholder="010-0000-0000" inputMode="tel" />
          </Field>
          <Field id="address" label="주소" className="sm:col-span-2">
            <Input id="address" name="address" defaultValue={member?.address ?? ""} />
          </Field>
          <Field id="guardian.name" label="학부모 이름">
            <Input id="guardian.name" name="guardian.name" defaultValue={g?.name ?? ""} />
          </Field>
          <Field id="guardian.relation" label="관계">
            <Input id="guardian.relation" name="guardian.relation" defaultValue={g?.relation ?? ""} placeholder="모 / 부" />
          </Field>
          <Field id="guardian.phone" label="학부모 연락처">
            <Input id="guardian.phone" name="guardian.phone" defaultValue={g?.phone ?? ""} inputMode="tel" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>등록 · 좌석</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {member ? null : (
            <>
              <Field id="status" label="상태">
                <select id="status" name="status" defaultValue="enrolled" className={selectClass}>
                  {MEMBER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="seatId" label="좌석" hint="등록 상태일 때만 배정됩니다">
                <select id="seatId" name="seatId" defaultValue="" className={selectClass}>
                  <option value="">미배정</option>
                  {seats.map((s) => (
                    <option key={s.seatId} value={s.seatId} disabled={Boolean(s.memberId)}>
                      {s.seatNo}번 ({s.zone}){s.memberName ? ` · ${s.memberName}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <Field id="enrollment.startDate" label="등록 시작일">
            <Input id="enrollment.startDate" name="enrollment.startDate" type="date" defaultValue={e?.startDate ?? ""} />
          </Field>
          <Field id="enrollment.endDate" label="등록 종료일">
            <Input id="enrollment.endDate" name="enrollment.endDate" type="date" defaultValue={e?.endDate ?? ""} />
          </Field>
          <Field id="enrollment.planType" label="등록 유형">
            <select id="enrollment.planType" name="enrollment.planType" defaultValue={e?.planType ?? "regular"} className={selectClass}>
              <option value="regular">정기</option>
              <option value="short">단기</option>
            </select>
          </Field>
          <Field id="firstRegisteredAt" label="첫 등록일">
            <Input id="firstRegisteredAt" name="firstRegisteredAt" type="date" defaultValue={member?.firstRegisteredAt ?? ""} />
          </Field>
          <Field id="firstCounseledAt" label="첫 상담일">
            <Input id="firstCounseledAt" name="firstCounseledAt" type="date" defaultValue={member?.firstCounseledAt ?? ""} />
          </Field>
        </CardContent>
      </Card>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function Field({ id, label, hint, required, className, children }: { id: string; label: string; hint?: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 block">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-destructive">
            {" "}
            *
          </span>
        ) : null}
      </Label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
