import Link from "next/link";
import { IssueCommentForm } from "@/components/app/issue-comment-form";
import { IssueStatusBadge, SeverityBadge } from "@/components/app/issue-badges";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IssueStatus } from "@/db/schema";
import { getCtx, MANAGER_ROLES } from "@/lib/auth/ctx";
import { fmtDateTime } from "@/lib/format";
import { updateIssueAction } from "@/modules/issues/actions";
import { getIssue, ISSUE_STATUS_LABEL } from "@/modules/issues/repo";
import { listUsers } from "@/modules/settings/repo";
import { guarded } from "@/lib/page-guard";

async function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  const { id } = await params;
  const issue = await getIssue(ctx, id);
  const canManage = MANAGER_ROLES.includes(ctx.role);
  const staff = canManage ? (await listUsers(ctx)).filter((u) => u.active && u.role !== "assistant") : [];
  const statuses: IssueStatus[] = ["open", "in_progress", "resolved"];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={issue.title}
        description={`${issue.reporterName ?? "-"} 보고 · ${fmtDateTime(issue.createdAt)}${issue.memberId ? "" : " · 회원과 무관"}`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/issues">목록</Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SeverityBadge severity={issue.severity} />
        <IssueStatusBadge status={issue.status} />
        {issue.memberId ? (
          <Link href={`/members/${issue.memberId}`} className="text-sm underline-offset-2 hover:underline">
            {issue.memberName}
          </Link>
        ) : null}
        {issue.assigneeName ? <span className="text-sm text-muted-foreground">담당 {issue.assigneeName}</span> : null}
        {issue.resolvedAt ? <span className="text-sm text-muted-foreground">해결 {fmtDateTime(issue.resolvedAt)}</span> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6 text-sm whitespace-pre-wrap">{issue.body ?? <span className="text-muted-foreground">내용 없음</span>}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">코멘트 ({issue.comments.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {issue.comments.map((c) => (
                <div key={c.id} className="rounded-md bg-muted/60 p-3 text-sm">
                  <div className="mb-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{c.authorName ?? "-"}</span> · {fmtDateTime(c.createdAt)}
                  </div>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
              <IssueCommentForm issueId={issue.id} key={issue.comments.length} />
            </CardContent>
          </Card>
        </div>
        {canManage ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">처리</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <form action={updateIssueAction} className="space-y-2">
                <input type="hidden" name="id" value={issue.id} />
                <div className="grid gap-1">
                  {statuses.map((s) => (
                    <Button key={s} type="submit" name="status" value={s} variant={issue.status === s ? "default" : "outline"} size="sm">
                      {ISSUE_STATUS_LABEL[s]}
                    </Button>
                  ))}
                </div>
              </form>
              <form action={updateIssueAction} className="space-y-2">
                <input type="hidden" name="id" value={issue.id} />
                <label className="text-xs text-muted-foreground">담당자</label>
                <div className="flex gap-1">
                  <select name="assignedTo" defaultValue={issue.assignedTo ?? ""} className="h-8 flex-1 rounded-md border bg-background px-2 text-sm">
                    <option value="">미지정</option>
                    {staff.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" variant="outline">
                    지정
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

export default guarded(IssueDetailPage);
