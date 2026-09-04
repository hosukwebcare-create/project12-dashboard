import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { BranchRole } from "@/db/schema";
import { getCtx, ROLE_LABEL } from "@/lib/auth/ctx";
import { upsertUserAction } from "@/modules/settings/actions";
import { listUsers } from "@/modules/settings/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "사용자" };

async function UsersSettingsPage() {
  const ctx = await getCtx();
  const users = await listUsers(ctx);
  const roles: BranchRole[] = ctx.role === "hq_admin" ? ["branch_manager", "mentor", "assistant"] : ["mentor", "assistant"];
  const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>새 사용자</CardTitle>
          <CardDescription>{ctx.role === "hq_admin" ? "이 지점에 소속된 계정을 만듭니다." : "지점장은 멘토·조교 계정만 만들 수 있습니다."}</CardDescription>
        </CardHeader>
        <CardContent>
          <InlineForm action={upsertUserAction} submitLabel="추가">
            <input type="hidden" name="active" value="true" />
            <Input name="loginId" placeholder="아이디" className="w-32" required autoComplete="off" />
            <Input name="name" placeholder="이름" className="w-28" required />
            <Input name="password" type="password" placeholder="비밀번호 (6자+)" className="w-36" required autoComplete="new-password" />
            <select name="role" defaultValue="assistant" className={selectClass}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </InlineForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>사용자 목록 ({users.length})</CardTitle>
          <CardDescription>비밀번호·PIN은 입력했을 때만 변경됩니다. PIN은 조교의 공용 태블릿 전환용입니다.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {users.map((u) => {
            const editable = ctx.role === "hq_admin" || roles.includes(u.role);
            return (
              <InlineForm key={u.id} action={upsertUserAction} className="py-2">
                <input type="hidden" name="id" value={u.id} />
                <Input name="loginId" defaultValue={u.loginId} className="w-32" readOnly={!editable} />
                <Input name="name" defaultValue={u.name} className="w-28" readOnly={!editable} />
                <select name="role" defaultValue={u.role} className={selectClass} disabled={!editable}>
                  {(editable ? roles : [u.role]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <Input name="password" type="password" placeholder="새 비밀번호" className="w-32" autoComplete="new-password" readOnly={!editable} />
                {u.role === "assistant" ? <Input name="pin" inputMode="numeric" placeholder={u.hasPin ? "PIN 변경" : "PIN 설정"} className="w-24" readOnly={!editable} /> : null}
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="active" defaultChecked={u.active} className="size-4" disabled={!editable} /> 활성
                </label>
              </InlineForm>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

export default guarded(UsersSettingsPage);
