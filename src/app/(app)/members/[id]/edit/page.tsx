import { MemberForm } from "@/components/app/member-form";
import { PageHeader } from "@/components/app/page-header";
import { getCtx, MANAGER_ROLES, requireRole } from "@/lib/auth/ctx";
import { updateMemberAction } from "@/modules/members/actions";
import { getMember, listSeatsWithOccupant } from "@/modules/members/repo";
import { customFieldsFor } from "@/modules/settings/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "회원 수정" };

async function EditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  requireRole(ctx, ...MANAGER_ROLES);
  const { id } = await params;
  const [member, seats, customFields] = await Promise.all([getMember(ctx, id), listSeatsWithOccupant(ctx), customFieldsFor(ctx, "member")]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`${member.name} 수정`} description="좌석과 상태는 회원 상세 화면에서 바꿉니다" />
      <MemberForm action={updateMemberAction} seats={seats} member={member} submitLabel="저장" customFields={customFields} />
    </div>
  );
}

export default guarded(EditMemberPage);
