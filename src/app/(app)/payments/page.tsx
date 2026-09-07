import Link from "next/link";
import { InlineForm } from "@/components/app/inline-form";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCtx } from "@/lib/auth/ctx";
import { fmtDate } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { cn } from "@/lib/utils";
import { saveSeatPaymentAction } from "@/modules/payments/actions";
import { PAYMENT_STATUSES, paymentSummary, paymentTargets } from "@/modules/payments/repo";

export const metadata = { title: "결제 대상" };

const won = (n: number) => n.toLocaleString("ko-KR");

type Search = { status?: string };

async function PaymentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await getCtx();
  const sp = await searchParams;
  const [all, summary] = await Promise.all([paymentTargets(ctx), paymentSummary(ctx)]);
  const filter = sp.status === "paid" || sp.status === "closed" ? sp.status : sp.status === "all" ? "all" : "pending";
  const rows = filter === "all" ? all : all.filter((r) => r.status === filter);

  return (
    <div className="space-y-5">
      <PageHeader
        title="결제 대상"
        description={`${ctx.branchName} · 좌석 이용료와 식사비를 한 곳에서`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/fees">요금표 · 좌석 등급</Link>
          </Button>
        }
      />

      <div className="grid gap-px overflow-hidden rounded-lg bg-border ring-1 ring-border sm:grid-cols-3">
        <div className="bg-card px-5 py-4">
          <p className="text-sm text-muted-foreground">좌석 이용료 미납</p>
          <p className="mt-1 text-[28px] leading-none font-semibold tracking-tight tabular-nums">
            {won(summary.seat.amount)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">원 · {summary.seat.pending}건</span>
          </p>
        </div>
        <div className="bg-card px-5 py-4">
          <p className="text-sm text-muted-foreground">식사비 미수</p>
          <p className="mt-1 text-[28px] leading-none font-semibold tracking-tight tabular-nums">
            {won(summary.meal.amount)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">원 · {summary.meal.pending}명</span>
          </p>
          <Link href="/meals/settlement" className="mt-1 inline-block text-[13px] text-muted-foreground hover:text-foreground hover:underline">
            식사 월 정산 열기
          </Link>
        </div>
        <div className="bg-card px-5 py-4">
          <p className="text-sm text-muted-foreground">합계</p>
          <p className="mt-1 text-[28px] leading-none font-semibold tracking-tight text-primary tabular-nums">
            {won(summary.total)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">원</span>
          </p>
          {summary.unpriced > 0 ? (
            <Link href="/settings/fees" className="mt-1 inline-block text-[13px] text-amber-700 hover:underline">
              금액 미정 {summary.unpriced}건 · 좌석 등급을 지정하세요
            </Link>
          ) : null}
        </div>
      </div>

      <nav className="pill-nav">
        {[
          { key: "pending", label: "예정" },
          { key: "paid", label: "완료" },
          { key: "closed", label: "종료" },
          { key: "all", label: "전체" },
        ].map((t) => (
          <Link key={t.key} href={`/payments?status=${t.key}`} className="pill" data-active={filter === t.key}>
            {t.label} {t.key === "all" ? all.length : all.filter((r) => r.status === t.key).length}
          </Link>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-lg bg-card ring-1 ring-border">
        <table className="data-table min-w-[70rem]">
          <thead>
            <tr>
              <th className="pl-3">좌석</th>
              <th>이름</th>
              <th>등급</th>
              <th>등록기간</th>
              <th className="px-2 text-right">금액</th>
              <th className="px-2 text-right">할인</th>
              <th className="px-2 text-right">청구</th>
              <th className="px-2">결제일</th>
              <th className="px-2">상태</th>
              <th className="px-2">메모</th>
              <th className="pr-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-10 text-center text-muted-foreground">
                  해당하는 결제 건이 없습니다
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                // 한 줄이 한 폼이지만 입력은 칸마다 흩어져 있어야 머리글과 맞는다. form 속성으로 묶는다.
                const formId = `pay-${r.enrollmentId}`;
                return (
                  <tr key={r.enrollmentId}>
                    <td className="pl-3 tabular-nums">{r.seatNo ?? "-"}</td>
                    <td className="font-medium whitespace-nowrap">
                      <Link href={`/members/${r.memberId}`} className="hover:underline">
                        {r.memberName}
                      </Link>
                      {r.memberKind === "adult" ? <span className="ml-1 text-xs font-normal text-muted-foreground">성인</span> : null}
                    </td>
                    <td className={cn("whitespace-nowrap", !r.planName && "text-amber-700")}>{r.planName ?? "등급 없음"}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {fmtDate(r.periodStart)} ~ {fmtDate(r.periodEnd)}
                    </td>
                    <td className="px-2 text-right">
                      <Input form={formId} name="baseAmount" defaultValue={String(r.baseAmount)} className="w-24 text-right tabular-nums" aria-label={`${r.memberName} 금액`} />
                    </td>
                    <td className="px-2 text-right">
                      <Input form={formId} name="discount" defaultValue={String(r.discount)} className="w-20 text-right tabular-nums" aria-label={`${r.memberName} 할인`} />
                    </td>
                    <td className="px-2 text-right font-semibold whitespace-nowrap tabular-nums">{won(r.amount)}</td>
                    <td className="px-2">
                      <Input form={formId} name="paidAt" type="date" defaultValue={r.paidAt ?? ""} className="w-36" aria-label={`${r.memberName} 결제일`} />
                    </td>
                    <td className="px-2">
                      <select
                        form={formId}
                        name="status"
                        defaultValue={r.status}
                        className="h-8 rounded-md border border-input bg-card px-2 text-sm"
                        aria-label={`${r.memberName} 상태`}
                      >
                        {PAYMENT_STATUSES.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2">
                      <Input form={formId} name="note" defaultValue={r.note ?? ""} placeholder="메모" className="w-28" aria-label={`${r.memberName} 메모`} />
                    </td>
                    <td className="pr-3">
                      <InlineForm id={formId} action={saveSeatPaymentAction} submitLabel="저장" className="max-w-[13rem] items-center justify-end gap-1">
                        {r.id ? <input type="hidden" name="id" value={r.id} /> : null}
                        <input type="hidden" name="enrollmentId" value={r.enrollmentId} />
                        <input type="hidden" name="memberId" value={r.memberId} />
                        <input type="hidden" name="periodStart" value={r.periodStart} />
                        <input type="hidden" name="periodEnd" value={r.periodEnd} />
                        <input type="hidden" name="planName" value={r.planName ?? ""} />
                      </InlineForm>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        금액은 좌석 등급과 회원 구분(학생·성인)으로 자동 계산됩니다. 그대로 두면 저장되지 않고, 값을 확인해 <b>저장</b>을 눌러야 결제 건으로 기록됩니다. 결제일을 넣으면 상태가 완료로 바뀝니다.
      </p>
    </div>
  );
}

export default guarded(PaymentsPage);
