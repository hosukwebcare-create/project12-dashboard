import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { getCtx } from "@/lib/auth/ctx";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { markAllReadAction } from "@/modules/notifications/actions";
import { listNotifications, type NotificationRow } from "@/modules/notifications/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "알림" };

const TYPE_LABEL: Record<string, string> = {
  issue: "이슈 보고",
  issue_status: "이슈 상태 변경",
  issue_comment: "이슈 코멘트",
  mention: "멘션",
  comment: "상담 코멘트",
  appointment: "상담 일정",
  handover: "인수인계",
};

function hrefFor(n: NotificationRow): string | null {
  const p = n.payload as Record<string, unknown>;
  if (typeof p.issueId === "string") return `/issues/${p.issueId}`;
  if (typeof p.logId === "string") return `/counsel/logs/${p.logId}`;
  if (typeof p.week === "string") return `/counsel/schedule?week=${p.week}`;
  if (typeof p.noteId === "string") return `/handover#${p.noteId}`;
  return null;
}

function textFor(n: NotificationRow): string {
  const p = n.payload as Record<string, unknown>;
  if (typeof p.title === "string") return p.title;
  if (typeof p.preview === "string") return p.preview;
  return "";
}

async function NotificationsPage() {
  const ctx = await getCtx();
  const rows = await listNotifications(ctx);
  const unread = rows.filter((r) => !r.readAt).length;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="알림"
        description={`읽지 않음 ${unread}건`}
        actions={
          unread > 0 ? (
            <form action={markAllReadAction}>
              <Button type="submit" variant="outline" size="sm">
                모두 읽음
              </Button>
            </form>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">알림이 없습니다</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((n) => {
            const href = hrefFor(n);
            const inner = (
              <div className={cn("px-4 py-3", !n.readAt && "bg-accent/40")}>
                <div className="flex items-center gap-2 text-sm">
                  <span className={cn(!n.readAt ? "font-semibold" : "font-medium text-muted-foreground")}>{TYPE_LABEL[n.type] ?? n.type}</span>
                  {/* 안 읽은 줄의 옅은 파란 바탕 위에서도 읽히게 흰 바탕 배지로 (파란 바탕 + 파란 글자는 3.9:1 로 모자란다) */}
                  {!n.readAt ? <span className="rounded-full bg-card px-1.5 py-px text-[11px] font-semibold text-primary ring-1 ring-primary/40">새 알림</span> : null}
                  <span className="ml-auto text-xs text-muted-foreground">{fmtRelative(n.createdAt)}</span>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">{textFor(n)}</p>
              </div>
            );
            return <li key={n.id}>{href ? <Link href={href}>{inner}</Link> : inner}</li>;
          })}
        </ul>
      )}
    </div>
  );
}

export default guarded(NotificationsPage);
