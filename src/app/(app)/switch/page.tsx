import { PageHeader } from "@/components/app/page-header";
import { PinSwitch } from "@/components/app/pin-switch";
import { getCtx } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { listPinUsers } from "@/modules/auth/pin";

export const metadata = { title: "사용자 전환" };

async function SwitchPage() {
  const ctx = await getCtx();
  const users = await listPinUsers(ctx);
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="사용자 전환" description={`${ctx.branchName} · 공용 태블릿에서 PIN으로 조교 계정을 바꿉니다`} />
      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">PIN이 설정된 조교가 없습니다. 설정 › 사용자에서 조교의 PIN을 설정하세요.</p>
      ) : (
        <PinSwitch users={users} currentUserId={ctx.userId} />
      )}
    </div>
  );
}

export default guarded(SwitchPage);
