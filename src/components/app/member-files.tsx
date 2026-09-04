"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MemberFileKind } from "@/db/schema";
import type { ActionState } from "@/lib/action-utils";
import { uploadMemberFileAction } from "@/modules/files/actions";

const KINDS: { key: MemberFileKind; label: string }[] = [
  { key: "ai_report", label: "AI 컨설팅 리포트" },
  { key: "hero_result", label: "HERO 진단 결과" },
  { key: "other", label: "기타" },
];

export function MemberFileUpload({ memberId }: { memberId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadMemberFileAction, {});
  return (
    <form action={action} className="space-y-2 rounded-md border p-3">
      <input type="hidden" name="memberId" value={memberId} />
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="kind">종류</Label>
          <select id="kind" name="kind" defaultValue="ai_report" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
            {KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="title">제목</Label>
          <Input id="title" name="title" placeholder="예: 9월 AI 컨설팅 리포트" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="file">파일 (PDF·이미지, 20MB 이하)</Label>
          <Input id="file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" required />
        </div>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-700">업로드했습니다</p> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "업로드 중…" : "업로드"}
      </Button>
    </form>
  );
}
