import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MessageStatus } from "@/db/schema";
import { getCtx, MANAGER_ROLES, requireRole } from "@/lib/auth/ctx";
import { fmtDateTime } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { cn } from "@/lib/utils";
import { retryFailedAction } from "@/modules/alimtalk/actions";
import { listMessages } from "@/modules/alimtalk/repo";

export const metadata = { title: "알림톡 발송 이력" };

const STATUS_LABEL: Record<MessageStatus, string> = { queued: "대기", sent: "발송", failed: "실패" };
const STATUS_STYLE: Record<MessageStatus, string> = { queued: "bg-amber-100 text-amber-800", sent: "bg-emerald-100 text-emerald-800", failed: "bg-red-100 text-red-800" };

async function AlimtalkHistoryPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await getCtx();
  requireRole(ctx, ...MANAGER_ROLES);
  const sp = await searchParams;
  const status = (["queued", "sent", "failed"] as MessageStatus[]).find((s) => s === sp.status);
  const rows = await listMessages(ctx, { status });
  const failedBatches = [...new Set(rows.filter((r) => r.status === "failed" && r.batchId).map((r) => r.batchId!))];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="알림톡 발송 이력"
        description={`${ctx.branchName} · 최근 ${rows.length}건`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/alimtalk">발송하기</Link>
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {[
          { k: "", l: "전체" },
          { k: "sent", l: "발송" },
          { k: "failed", l: "실패" },
          { k: "queued", l: "대기" },
        ].map((f) => (
          <Link key={f.k} href={`/alimtalk/history${f.k ? `?status=${f.k}` : ""}`} className="pill" data-active={(status ?? "") === f.k}>
            {f.l}
          </Link>
        ))}
        {failedBatches.map((b) => (
          <form key={b} action={retryFailedAction} className="ml-auto">
            <input type="hidden" name="batchId" value={b} />
            <Button type="submit" size="sm" variant="outline">
              실패 재발송 ({b.slice(0, 8)})
            </Button>
          </form>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">발송 이력이 없습니다</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card shadow-(--shadow-card) ring-1 ring-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs font-medium tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">일시</th>
                <th className="px-3 py-2">템플릿</th>
                <th className="px-3 py-2">수신</th>
                <th className="px-3 py-2">번호</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">내용</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-t align-top">
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtDateTime(m.sentAt ?? m.createdAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{m.templateName ?? "-"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {m.memberName ?? m.recipientName ?? "-"}
                    {m.recipientType === "guardian" ? <span className="ml-1 text-xs text-muted-foreground">학부모</span> : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{m.recipientPhone}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={cn("border-transparent", STATUS_STYLE[m.status])}>
                      {STATUS_LABEL[m.status]}
                    </Badge>
                    {m.error ? <div className="mt-1 text-xs text-destructive">{m.error}</div> : null}
                  </td>
                  <td className="max-w-md px-3 py-2 text-xs text-muted-foreground">{m.renderedText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default guarded(AlimtalkHistoryPage);
