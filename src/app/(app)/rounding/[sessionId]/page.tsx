import { CheckSheet } from "@/components/app/check-sheet";
import { PageHeader } from "@/components/app/page-header";
import { getCtx } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { completeSessionAction, saveCheckAction } from "@/modules/rounding/actions";
import { sessionSheet } from "@/modules/rounding/repo";

async function RoundSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const ctx = await getCtx();
  const { sessionId } = await params;
  const { session, rows, rules } = await sessionSheet(ctx, sessionId);
  const canEdit = ctx.role !== "mentor";
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`R${session.roundNo} 라운딩`}
        description={`${fmtShortDate(session.date)} · ${ctx.branchName}${session.completedAt ? " · 완료됨" : ""}`}
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

import { GradeChip } from "@/components/app/grade-chip";
import type { SheetRow } from "@/modules/rounding/repo";
import { guarded } from "@/lib/page-guard";

function ReadOnlySheet({ rows }: { rows: SheetRow[] }) {
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((r) => (
        <li key={r.memberId} className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className="w-8 text-center font-semibold tabular-nums">{r.seatNo ?? "-"}</span>
          <span className="flex-1">{r.name}</span>
          <GradeChip grade={r.grade} points={r.points} />
        </li>
      ))}
    </ul>
  );
}

export default guarded(RoundSessionPage);
