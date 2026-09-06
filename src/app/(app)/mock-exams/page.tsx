import Link from "next/link";
import { InlineForm } from "@/components/app/inline-form";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCtx, MANAGER_ROLES } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { todayKey } from "@/lib/rules/week";
import { upsertRoundAction } from "@/modules/mock-exams/actions";
import { listRounds } from "@/modules/mock-exams/repo";

export const metadata = { title: "모의고사" };

async function MockExamsPage() {
  const ctx = await getCtx();
  const rounds = await listRounds(ctx);
  const canManage = MANAGER_ROLES.includes(ctx.role);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="모의고사" description={`${ctx.branchName} · 회차별 신청·결제 관리`} />
      {canManage ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>새 회차</CardTitle>
            <CardDescription>월과 이름, 1인 응시료를 입력합니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <InlineForm action={upsertRoundAction} submitLabel="회차 만들기">
              <Input name="yearMonth" type="month" defaultValue={todayKey().slice(0, 7)} className="w-40" required aria-label="회차 월" />
              <Input name="name" placeholder="회차 이름 (예: 9월 모의고사)" className="w-56" required />
              <Input name="price" type="number" min={0} step={1000} defaultValue={29000} className="w-32" aria-label="응시료" />
            </InlineForm>
          </CardContent>
        </Card>
      ) : null}
      {rounds.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">등록된 회차가 없습니다</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rounds.map((r) => (
            <li key={r.id}>
              <Link href={`/mock-exams/${r.id}`} className="flex flex-wrap items-center gap-3 px-3 py-3 hover:bg-muted/50">
                <span className="w-20 text-sm tabular-nums text-muted-foreground">{r.yearMonth}</span>
                <span className="font-medium">{r.name}</span>
                <span className="text-sm text-muted-foreground">{r.price.toLocaleString()}원</span>
                <span className="ml-auto text-sm">신청 {r.appliedCount}명</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default guarded(MockExamsPage);
