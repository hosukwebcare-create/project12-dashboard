import { ImportWizard } from "@/components/app/import-wizard";
import { PageHeader } from "@/components/app/page-header";
import { getCtx, MANAGER_ROLES, requireRole } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { IMPORT_FIELDS } from "@/modules/members/import";

export const metadata = { title: "회원 이관" };

async function ImportPage() {
  const ctx = await getCtx();
  requireRole(ctx, ...MANAGER_ROLES);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="회원 CSV 이관" description={`${ctx.branchName} · 기존 구글시트(고객정보) 데이터를 붙여넣어 한 번에 등록합니다`} />
      <ImportWizard fields={IMPORT_FIELDS.map(({ key, label }) => ({ key, label }))} />
    </div>
  );
}

export default guarded(ImportPage);
