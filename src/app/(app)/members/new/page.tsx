import { MemberForm } from "@/components/app/member-form";
import { PageHeader } from "@/components/app/page-header";
import { getCtx, MANAGER_ROLES, requireRole } from "@/lib/auth/ctx";
import { createMemberAction } from "@/modules/members/actions";
import { listSeatsWithOccupant } from "@/modules/members/repo";
import { customFieldsFor } from "@/modules/settings/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "회원 등록" };

async function NewMemberPage() {
  const ctx = await getCtx();
  requireRole(ctx, ...MANAGER_ROLES);
  const [seats, customFields] = await Promise.all([listSeatsWithOccupant(ctx), customFieldsFor(ctx, "member")]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="회원 등록" description={ctx.branchName} />
      <MemberForm action={createMemberAction} seats={seats} submitLabel="등록" customFields={customFields} />
    </div>
  );
}

export default guarded(NewMemberPage);
