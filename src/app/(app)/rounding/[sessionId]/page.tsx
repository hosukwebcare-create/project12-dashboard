import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { CheckSheet } from "@/components/app/check-sheet";
import { GradeChip } from "@/components/app/grade-chip";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { getCtx } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { completeSessionAction, saveCheckAction } from "@/modules/rounding/actions";
import { sessionSheet, type SheetRow } from "@/modules/rounding/repo";

async function RoundSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const ctx = await getCtx();
  const { sessionId } = await params;
  const { session, rows, rules } = await sessionSheet(ctx, sessionId);
  const canEdit = ctx.role !== "mentor";
  const schedule = ctx.settings.roundSchedule ?? [];
  const startAt = schedule[session.roundNo - 1];
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`R${session.roundNo} 라운딩`}
        description={`${fmtShortDate(session.date)} · ${ctx.branchName}${startAt ? ` · ${startAt} 시작` : ""}`}
        actions={
          <>
            {session.completedAt ? (
              <span className="rounded-sm bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-800">완료됨</span>
            ) : (
              <span className="rounded-sm bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground">진행 중</span>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href="/rounding">
                <ArrowLeft /> 회차 목록
              </Link>
            </Button>
          </>
        }
      />
      {canEdit ? (
        <CheckSheet
          date={session.date}
          itemKey="round"
          roundNo={session.roundNo}
          sessionId={session.id}
          rows={rows}
          rules={rules}
          saveAction={saveCheckAction}
          completeAction={completeSessionAction}
          completed={Boolean(session.completedAt)}
        />
      ) : (
        <ReadOnlySheet rows={rows} />
      )}
    </div>
  );
}

function ReadOnlySheet({ rows }: { rows: SheetRow[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-border">
      {rows.map((r) => (
        <li key={r.memberId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
          <span className="w-7 text-right font-medium text-muted-foreground">{r.seatNo ?? "-"}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{r.name}</span>
            {r.grade === "p" && r.note ? <span className="block truncate text-xs text-muted-foreground">{r.note}</span> : null}
          </span>
          <GradeChip grade={r.grade} points={r.points} />
        </li>
      ))}
    </ul>
  );
}

export default guarded(RoundSessionPage);
