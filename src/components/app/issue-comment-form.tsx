"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ActionState } from "@/lib/action-utils";
import { addIssueCommentAction } from "@/modules/issues/actions";

export function IssueCommentForm({ issueId }: { issueId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addIssueCommentAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={issueId} />
      <Textarea name="body" rows={2} required placeholder="코멘트를 남기면 보고자·담당자에게 알림이 갑니다" />
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "등록 중…" : "코멘트 남기기"}
        </Button>
      </div>
    </form>
  );
}
