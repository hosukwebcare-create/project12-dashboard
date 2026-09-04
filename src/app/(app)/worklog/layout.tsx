import { PageHeader } from "@/components/app/page-header";
import { SubNav } from "@/components/app/sub-nav";
import { getCtx, MANAGER_ROLES } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";

async function WorklogLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const canManage = MANAGER_ROLES.includes(ctx.role);
  const items = [
    { href: "/worklog", label: "내 근무" },
    ...(canManage ? [{ href: "/worklog/daily", label: "일별 현황" }, { href: "/worklog/monthly", label: "월 집계" }, { href: "/worklog/settings", label: "타임·직원 설정" }] : []),
  ];
  return (
    <div>
      <PageHeader title="근무일지" description={`${ctx.branchName} · 타임별 출퇴근 체크 · 초과근무 · 월 집계`} />
      <SubNav items={items} />
      {children}
    </div>
  );
}

export default guarded(WorklogLayout);
