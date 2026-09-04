"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionState } from "@/lib/action-utils";
import { createIssueAction } from "@/modules/issues/actions";

export function IssueForm({ members }: { members: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createIssueAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="memberId">회원 (선택)</Label>
        <select id="memberId" name="memberId" defaultValue="" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
          <option value="">회원과 무관한 이슈</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="title">제목</Label>
        <Input id="title" name="title" required maxLength={100} placeholder="예: 3번 좌석 휴대폰 사용 반복" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="body">내용</Label>
        <Textarea id="body" name="body" rows={4} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="severity">심각도</Label>
        <select id="severity" name="severity" defaultValue="normal" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
          <option value="low">낮음</option>
          <option value="normal">보통</option>
          <option value="high">높음</option>
        </select>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "등록 중…" : "이슈 등록"}
      </Button>
    </form>
  );
}
