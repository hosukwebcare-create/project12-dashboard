import { Plus } from "lucide-react";
import Link from "next/link";
import { IssueStatusBadge, SeverityBadge } from "@/components/app/issue-badges";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import type { IssueStatus } from "@/db/schema";
import { getCtx } from "@/lib/auth/ctx";
import { fmtRelative } from "@/lib/format";
import { listIssues } from "@/modules/issues/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "이슈함" };

const FILTERS: { key: string; label: string; status?: IssueStatus }[] = [
  { key: "open", label: "접수", status: "open" },
  { key: "in_progress", label: "처리 중", status: "in_progress" },
  { key: "resolved", label: "해결", status: "resolved" },
  { key: "all", label: "전체" },
];

async function IssuesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await getCtx();
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.status) ?? FILTERS[0];
  const rows = await listIssues(ctx, filter.status);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="이슈함"
        description={`${ctx.branchName} · ${rows.length}건`}
        actions={
          <Button asChild>
            <Link href="/issues/new">
              <Plus /> 이슈 등록
            </Link>
          </Button>
        }
      />
      <div className="pill-nav mb-4">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/issues?status=${f.key}`} className="pill" data-active={f.key === filter.key}>
            {f.label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">해당 상태의 이슈가 없습니다</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((i) => (
            <li key={i.id}>
              <Link href={`/issues/${i.id}`} className="block px-3 py-3 hover:bg-muted/50">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={i.severity} />
                  <span className="font-medium">{i.title}</span>
                  <IssueStatusBadge status={i.status} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {i.memberName ? `${i.memberName} · ` : ""}
                  {i.reporterName ?? "-"} 보고 · {fmtRelative(i.createdAt)}
                  {i.assigneeName ? ` · 담당 ${i.assigneeName}` : ""}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default guarded(IssuesPage);
