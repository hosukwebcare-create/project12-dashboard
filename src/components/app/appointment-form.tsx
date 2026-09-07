"use client";

import { useState } from "react";
import { InlineForm } from "@/components/app/inline-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AppointmentKind } from "@/db/schema";
import type { ActionState } from "@/lib/action-utils";

export type AppointmentDraft = {
  id?: string;
  date: string;
  startTime: string;
  endTime?: string | null;
  kind: AppointmentKind;
  memberId?: string | null;
  personName?: string | null;
  personPhone?: string | null;
  assignedTo?: string | null;
  note?: string | null;
  status?: string;
};

const SELECT = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm";

/**
 * 상담 일정 등록·수정. 신규 상담은 아직 회원이 아니므로 이름·연락처를 직접 적고,
 * 재상담·학부모 상담은 회원을 고른다. 그래서 종류에 따라 입력칸이 바뀐다.
 */
export function AppointmentForm({
  action,
  draft,
  members,
  staff,
  kinds,
  statuses,
  submitLabel = "저장",
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  draft: AppointmentDraft;
  members: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  kinds: { key: AppointmentKind; label: string }[];
  statuses: { key: string; label: string }[];
  submitLabel?: string;
}) {
  const [kind, setKind] = useState<AppointmentKind>(draft.kind);
  const needsMember = kind !== "new";

  return (
    <InlineForm action={action} submitLabel={submitLabel} className="flex-col items-stretch gap-3">
      {draft.id ? <input type="hidden" name="id" value={draft.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="date">날짜</Label>
          <Input id="date" name="date" type="date" defaultValue={draft.date} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="startTime">시작</Label>
          <Input id="startTime" name="startTime" type="time" defaultValue={draft.startTime} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="endTime">종료 (선택)</Label>
          <Input id="endTime" name="endTime" type="time" defaultValue={draft.endTime ?? ""} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="kind">종류</Label>
          <select id="kind" name="kind" className={SELECT} value={kind} onChange={(e) => setKind(e.target.value as AppointmentKind)}>
            {kinds.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="assignedTo">담당</Label>
          <select id="assignedTo" name="assignedTo" className={SELECT} defaultValue={draft.assignedTo ?? ""}>
            <option value="">미지정</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {needsMember ? (
        <div className="space-y-1">
          <Label htmlFor="memberId">회원</Label>
          <select id="memberId" name="memberId" className={SELECT} defaultValue={draft.memberId ?? ""}>
            <option value="">고르세요</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="personName">이름</Label>
            <Input id="personName" name="personName" defaultValue={draft.personName ?? ""} placeholder="상담 오는 분 이름" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="personPhone">연락처</Label>
            <Input id="personPhone" name="personPhone" defaultValue={draft.personPhone ?? ""} placeholder="010-0000-0000" />
          </div>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="note">메모</Label>
        <Textarea id="note" name="note" rows={2} defaultValue={draft.note ?? ""} placeholder="상담 내용, 유입 경로 등" />
      </div>

      {draft.id ? (
        <div className="space-y-1">
          <Label htmlFor="status">상태</Label>
          <select id="status" name="status" className={SELECT} defaultValue={draft.status ?? "scheduled"}>
            {statuses.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="status" value="scheduled" />
      )}
    </InlineForm>
  );
}
