import { IssueForm } from "@/components/app/issue-form";
import { PageHeader } from "@/components/app/page-header";
import { getCtx } from "@/lib/auth/ctx";
import { listMembers } from "@/modules/members/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "이슈 등록" };

async function NewIssuePage() {
  const ctx = await getCtx();
  const members = await listMembers(ctx, { status: "enrolled" });
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="이슈 등록" description={`${ctx.branchName} · 지점장에게 즉시 알림이 갑니다`} />
      <IssueForm members={members.map((m) => ({ id: m.id, label: `${m.seatNo ?? "-"}번 · ${m.name}` }))} />
    </div>
  );
}

export default guarded(NewIssuePage);
