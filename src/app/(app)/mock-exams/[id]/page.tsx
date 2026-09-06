import Link from "next/link";
import { InlineForm } from "@/components/app/inline-form";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCtx, MANAGER_ROLES } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { cn } from "@/lib/utils";
import { TRACKS } from "@/modules/members/schema";
import { upsertApplicationAction, upsertRoundAction } from "@/modules/mock-exams/actions";
import { roundGrid } from "@/modules/mock-exams/repo";

async function MockExamRoundPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  const { id } = await params;
  const { round, rows, summary } = await roundGrid(ctx, id);
  const canManage = MANAGER_ROLES.includes(ctx.role);
  const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`${round.yearMonth} · ${round.name}`}
        description={`응시료 ${round.price.toLocaleString()}원 · 등록 회원 ${rows.length}명`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/mock-exams">회차 목록</Link>
          </Button>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="신청" value={`${summary.applied}명`} />
        <Stat label="결제 완료 / 미결제" value={`${summary.paid} / ${summary.unpaid}`} />
        <Stat label="계열별" value={Object.entries(summary.byTrack).map(([k, v]) => `${k} ${v}`).join(" · ") || "-"} />
        <Stat label="예상 / 입금" value={`${summary.expectedAmount.toLocaleString()} / ${summary.paidAmount.toLocaleString()}원`} />
      </div>

      {canManage ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">회차 정보 수정</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineForm action={upsertRoundAction}>
              <input type="hidden" name="id" value={round.id} />
              <Input name="yearMonth" type="month" defaultValue={round.yearMonth} className="w-40" />
              <Input name="name" defaultValue={round.name} className="w-56" />
              <Input name="price" type="number" min={0} step={1000} defaultValue={round.price} className="w-32" />
            </InlineForm>
          </CardContent>
        </Card>
      ) : null}

      <div className="overflow-x-auto rounded-xl bg-card shadow-(--shadow-card) ring-1 ring-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs font-medium tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-2">좌석</th>
              <th className="px-2 py-2">이름</th>
              <th className="px-2 py-2">신청</th>
              <th className="px-2 py-2">계열</th>
              <th className="px-2 py-2">과목 조합</th>
              <th className="px-2 py-2">결제일</th>
              <th className="px-2 py-2">결제액</th>
              <th className="px-2 py-2">비고</th>
              {canManage ? <th className="px-2 py-2"></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.memberId} className={cn("border-t", r.applied && !r.paidAt && "bg-amber-50/60")}>
                {canManage ? (
                  <td colSpan={9} className="px-2 py-1">
                    <InlineForm action={upsertApplicationAction} className="items-center">
                      <input type="hidden" name="roundId" value={round.id} />
                      <input type="hidden" name="memberId" value={r.memberId} />
                      <span className="w-8 tabular-nums">{r.seatNo ?? "-"}</span>
                      <Link href={`/members/${r.memberId}`} className="w-20 font-medium hover:underline">
                        {r.name}
                      </Link>
                      <label className="flex items-center gap-1 text-sm">
                        <input type="checkbox" name="applied" defaultChecked={r.applied} className="size-4" /> 신청
                      </label>
                      <select name="track" defaultValue={r.track ?? r.memberTrack ?? ""} className={selectClass} aria-label="계열">
                        <option value="">계열</option>
                        {TRACKS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <Input name="subjects" defaultValue={r.subjects ?? ""} placeholder="과목 조합" className="w-44" />
                      <Input name="paidAt" type="date" defaultValue={r.paidAt ?? ""} className="w-40" aria-label="결제일" />
                      <Input name="paidAmount" type="number" min={0} step={1000} defaultValue={r.paidAmount ?? (r.applied ? round.price : "")} placeholder="결제액" className="w-28" />
                      <Input name="note" defaultValue={r.note ?? ""} placeholder="비고" className="w-36" />
                    </InlineForm>
                  </td>
                ) : (
                  <>
                    <td className="px-2 py-2 tabular-nums">{r.seatNo ?? "-"}</td>
                    <td className="px-2 py-2 font-medium">{r.name}</td>
                    <td className="px-2 py-2">{r.applied ? "O" : ""}</td>
                    <td className="px-2 py-2">{r.track ?? ""}</td>
                    <td className="px-2 py-2">{r.subjects ?? ""}</td>
                    <td className="px-2 py-2">{r.paidAt ?? ""}</td>
                    <td className="px-2 py-2">{r.paidAmount?.toLocaleString() ?? ""}</td>
                    <td className="px-2 py-2">{r.note ?? ""}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

export default guarded(MockExamRoundPage);
