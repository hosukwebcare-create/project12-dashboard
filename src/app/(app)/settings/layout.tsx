import { PageHeader } from "@/components/app/page-header";
import { SettingsNav } from "@/components/app/settings-nav";
import { getCtx, MANAGER_ROLES, requireRole } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";

async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  requireRole(ctx, ...MANAGER_ROLES);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="설정" description={ctx.branchName} />
      <SettingsNav isHq={ctx.role === "hq_admin"} />
      {children}
    </div>
  );
}

export default guarded(SettingsLayout);
