"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CounselLogType } from "@/db/schema";
import type { ActionState } from "@/lib/action-utils";
import type { Role } from "@/lib/auth/ctx";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addCommentAction, saveLogAction, type SaveLogState } from "@/modules/counsel/actions";
import type { CounselLogDetail } from "@/modules/counsel/repo";

type Props = {
  memberId: string;
  logType: CounselLogType;
  periodDate: string;
  log: CounselLogDetail | null;
  role: Role;
};

/**
 * 상담일지 본문. 종이 일지처럼 원장 열과 멘토 열이 나란히 놓이고, 각자 자기 열만 쓴다.
 * 카드 대신 제목 아래 굵은 선 하나로 열을 나눈다.
 */
export function CounselEntry({ memberId, logType, periodDate, log, role }: Props) {
  const canIssue = role === "hq_admin" || role === "branch_manager";
  const canResolution = role === "hq_admin" || role === "mentor";
  return (
    <div>
      <div className="grid gap-10 md:grid-cols-2 md:gap-12">
        <FieldColumn
          title="정보 및 이슈"
          who="원장"
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
        <FieldColumn
          title="이슈 해결 내용"
          who="멘토"
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
      <div className="mt-12">{log ? <CommentThread log={log} /> : <p className="border-t border-border pt-4 text-sm text-muted-foreground">먼저 내용을 저장하면 코멘트를 남길 수 있습니다.</p>}</div>
    </div>
  );
}

function FieldColumn(props: { title: string; who: string; field: "issue" | "resolution"; editable: boolean; memberId: string; logType: CounselLogType; periodDate: string; logId: string | null; text: string; by: string | null; at: Date | null }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<SaveLogState, FormData>(saveLogAction, {});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (state.ok && state.logId && !props.logId) router.replace(`/counsel/logs/${state.logId}`);
    else if (state.ok) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.logId]);

  return (
    <section>
      <header className="flex items-baseline justify-between gap-3 border-b-2 border-foreground pb-2">
        <h2 className="text-sm font-semibold">
          {props.title} <span className="ml-1 font-normal text-muted-foreground">{props.who}</span>
        </h2>
        {props.by ? (
          <span className="text-xs text-muted-foreground">
            {props.by} · {fmtDateTime(props.at)}
          </span>
        ) : null}
      </header>
      {props.editable ? (
        <form action={action} onSubmit={() => setDirty(false)} className="mt-3">
          <input type="hidden" name="memberId" value={props.memberId} />
          <input type="hidden" name="logType" value={props.logType} />
          <input type="hidden" name="periodDate" value={props.periodDate} />
          <input type="hidden" name="field" value={props.field} />
          <textarea
            name="text"
            defaultValue={props.text}
            rows={8}
            placeholder="내용을 입력하세요"
            aria-label={`${props.title} 내용`}
            onChange={() => setDirty(true)}
            className={cn(
              "block w-full resize-y rounded-md border border-transparent bg-transparent px-0 py-1 text-[15px] leading-7 outline-none transition-colors placeholder:text-muted-foreground",
              "hover:border-border focus:border-border focus:bg-card focus:px-3",
            )}
          />
          <div className="mt-2 flex items-center justify-end gap-3 border-t border-border pt-2">
            {state.error ? <p className="mr-auto text-sm text-destructive">{state.error}</p> : null}
            {state.ok && !dirty ? <span className="text-xs text-muted-foreground">저장됨</span> : dirty ? <span className="text-xs text-warning">저장되지 않은 변경</span> : null}
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>
        </form>
      ) : props.text ? (
        <p className="mt-3 text-[15px] leading-7 whitespace-pre-wrap">{props.text}</p>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">아직 작성되지 않았습니다</p>
      )}
    </section>
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
    <section>
      <header className="flex items-baseline justify-between border-b border-border pb-2">
        <h2 className="text-sm font-semibold">코멘트 ({log.comments.length})</h2>
      </header>
      {log.comments.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">아직 코멘트가 없습니다</p>
      ) : (
        <ul className="divide-y divide-border">
          {log.comments.map((c) => (
            <li key={c.id} className="grid gap-1 py-3 text-sm md:grid-cols-[10rem_1fr] md:gap-4">
              <div className="text-xs text-muted-foreground md:pt-0.5">
                <span className="font-medium text-foreground">{c.authorName ?? "-"}</span>
                <span className="block">{fmtDateTime(c.createdAt)}</span>
              </div>
              <p className="leading-relaxed whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form action={action} key={log.comments.length} className="mt-3 border-t border-border pt-3">
        <input type="hidden" name="logId" value={log.id} />
        <textarea name="body" rows={2} required placeholder="@이름 으로 멘션하면 알림이 갑니다" aria-label="코멘트" className="block w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30" />
        {state.error ? <p className="mt-1 text-sm text-destructive">{state.error}</p> : null}
        <div className="mt-2 flex justify-end">
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "등록 중…" : "코멘트 남기기"}
          </Button>
        </div>
      </form>
    </section>
  );
}
