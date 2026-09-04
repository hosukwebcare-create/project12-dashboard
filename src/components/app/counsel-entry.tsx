"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { CounselLogType } from "@/db/schema";
import type { ActionState } from "@/lib/action-utils";
import type { Role } from "@/lib/auth/ctx";
import { fmtDateTime } from "@/lib/format";
import { addCommentAction, saveLogAction, type SaveLogState } from "@/modules/counsel/actions";
import type { CounselLogDetail } from "@/modules/counsel/repo";

type Props = {
  memberId: string;
  logType: CounselLogType;
  periodDate: string;
  log: CounselLogDetail | null;
  role: Role;
};

export function CounselEntry({ memberId, logType, periodDate, log, role }: Props) {
  const canIssue = role === "hq_admin" || role === "branch_manager";
  const canResolution = role === "hq_admin" || role === "mentor";
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <FieldCard
          title="정보 및 이슈 (원장)"
          field="issue"
          editable={canIssue}
          memberId={memberId}
          logType={logType}
          periodDate={periodDate}
          logId={log?.id ?? null}
          text={log?.issueText ?? ""}
          by={log?.issueByName ?? null}
          at={log?.issueAt ?? null}
        />
        <FieldCard
          title="이슈 해결 내용 (멘토)"
          field="resolution"
          editable={canResolution}
          memberId={memberId}
          logType={logType}
          periodDate={periodDate}
          logId={log?.id ?? null}
          text={log?.resolutionText ?? ""}
          by={log?.resolutionByName ?? null}
          at={log?.resolutionAt ?? null}
        />
      </div>
      {log ? <CommentThread log={log} /> : <p className="text-sm text-muted-foreground">먼저 내용을 저장하면 코멘트를 남길 수 있습니다.</p>}
    </div>
  );
}

function FieldCard(props: { title: string; field: "issue" | "resolution"; editable: boolean; memberId: string; logType: CounselLogType; periodDate: string; logId: string | null; text: string; by: string | null; at: Date | null }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<SaveLogState, FormData>(saveLogAction, {});
  useEffect(() => {
    if (state.ok && state.logId && !props.logId) router.replace(`/counsel/logs/${state.logId}`);
    else if (state.ok) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.logId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between text-base">
          {props.title}
          {props.by ? (
            <span className="text-xs font-normal text-muted-foreground">
              {props.by} · {fmtDateTime(props.at)}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {props.editable ? (
          <form action={action} className="space-y-2">
            <input type="hidden" name="memberId" value={props.memberId} />
            <input type="hidden" name="logType" value={props.logType} />
            <input type="hidden" name="periodDate" value={props.periodDate} />
            <input type="hidden" name="field" value={props.field} />
            <Textarea name="text" defaultValue={props.text} rows={6} placeholder="내용을 입력하세요" />
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            <div className="flex items-center justify-end gap-2">
              {state.ok ? <span className="text-xs text-emerald-700">저장됨</span> : null}
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "저장 중…" : "저장"}
              </Button>
            </div>
          </form>
        ) : props.text ? (
          <p className="whitespace-pre-wrap text-sm">{props.text}</p>
        ) : (
          <p className="text-sm text-muted-foreground">아직 작성되지 않았습니다</p>
        )}
      </CardContent>
    </Card>
  );
}

function CommentThread({ log }: { log: CounselLogDetail }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(addCommentAction, {});
  useEffect(() => {
    if (state.ok) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">코멘트 ({log.comments.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {log.comments.length === 0 ? <p className="text-sm text-muted-foreground">아직 코멘트가 없습니다</p> : null}
        <ul className="space-y-3">
          {log.comments.map((c) => (
            <li key={c.id} className="rounded-md bg-muted/60 p-3 text-sm">
              <div className="mb-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{c.authorName ?? "-"}</span> · {fmtDateTime(c.createdAt)}
              </div>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
        <form action={action} key={log.comments.length} className="space-y-2">
          <input type="hidden" name="logId" value={log.id} />
          <Textarea name="body" rows={2} placeholder="@이름 으로 멘션하면 알림이 갑니다" required />
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {pending ? "등록 중…" : "코멘트 남기기"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
