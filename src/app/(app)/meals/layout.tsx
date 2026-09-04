import { MealsNav } from "@/components/app/meals-nav";
import { PageHeader } from "@/components/app/page-header";
import { getCtx, requireRole } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";

async function MealsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  requireRole(ctx, "hq_admin", "branch_manager", "assistant");
  return (
    <div>
      <PageHeader title="식사주문" description={`${ctx.branchName} · 월별 신청 · 일별 발주 · 월 정산`} />
      <MealsNav canManage={ctx.role !== "assistant"} />
      {children}
    </div>
  );
}

export default guarded(MealsLayout);
