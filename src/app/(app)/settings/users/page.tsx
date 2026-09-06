import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { BranchRole } from "@/db/schema";
import { getCtx, ROLE_LABEL } from "@/lib/auth/ctx";
import { fmtDateTime } from "@/lib/format";
import { unlockUserAction, upsertHqAdminAction, upsertUserAction } from "@/modules/settings/actions";
import { listHqAdmins, listUsers } from "@/modules/settings/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "사용자" };

const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

/** 잠긴 계정에만 보이는 해제 버튼. form 안에 form 을 넣을 수 없어 행에서 형제로 둔다 */
function LockNotice({ id, until }: { id: string; until: Date }) {
  return (
    <div className="flex items-end gap-1.5">
      <span className="pb-1.5 text-xs text-destructive">{fmtDateTime(until)}까지 잠김</span>
      <InlineForm action={unlockUserAction} submitLabel="잠금 해제">
        <input type="hidden" name="id" value={id} />
      </InlineForm>
    </div>
  );
}

async function UsersSettingsPage() {
  const ctx = await getCtx();
  const users = await listUsers(ctx);
  const isHq = ctx.role === "hq_admin";
  const hqAdmins = isHq ? await listHqAdmins(ctx) : [];
  const roles: BranchRole[] = isHq ? ["branch_manager", "mentor", "assistant"] : ["mentor", "assistant"];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>새 사용자</CardTitle>
          <CardDescription>{isHq ? `${ctx.branchName} 지점에 소속된 계정을 만듭니다.` : "지점장은 멘토·조교 계정만 만들 수 있습니다."}</CardDescription>
        </CardHeader>
        <CardContent>
          <InlineForm action={upsertUserAction} submitLabel="추가">
            <input type="hidden" name="active" value="true" />
            <Input name="loginId" placeholder="아이디" className="w-32" required autoComplete="off" />
            <Input name="name" placeholder="이름" className="w-28" required />
            <Input name="password" type="password" placeholder="비밀번호 (영문+숫자 10자)" className="w-52" required autoComplete="new-password" />
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
          <CardDescription>
            비밀번호·PIN은 입력했을 때만 변경됩니다. 비밀번호를 바꾸면 그 계정으로 로그인된 기기가 모두 로그아웃됩니다. PIN은 조교의 공용 태블릿 전환용입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {users.map((u) => {
            const editable = isHq || roles.includes(u.role);
            return (
              <div key={u.id} className="flex flex-wrap items-end gap-x-3 py-2">
                <InlineForm action={upsertUserAction}>
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
                {u.lockedUntil && isHq ? <LockNotice id={u.id} until={u.lockedUntil} /> : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {isHq ? (
        <Card>
          <CardHeader>
            <CardTitle>본사 관리자 ({hqAdmins.length})</CardTitle>
            <CardDescription>지점에 소속되지 않고 모든 지점을 봅니다. 한 명은 반드시 활성으로 남아야 하므로 마지막 계정과 자기 계정은 끌 수 없습니다.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            <InlineForm action={upsertHqAdminAction} submitLabel="추가" className="pb-3">
              <input type="hidden" name="active" value="true" />
              <Input name="loginId" placeholder="아이디" className="w-32" required autoComplete="off" />
              <Input name="name" placeholder="이름" className="w-28" required />
              <Input name="password" type="password" placeholder="비밀번호 (영문+숫자 10자)" className="w-52" required autoComplete="new-password" />
            </InlineForm>
            {hqAdmins.map((a) => {
              return (
                <div key={a.id} className="flex flex-wrap items-end gap-x-3 py-2">
                  <InlineForm action={upsertHqAdminAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <Input name="loginId" defaultValue={a.loginId} className="w-32" />
                    <Input name="name" defaultValue={a.name} className="w-28" />
                    <Input name="password" type="password" placeholder="새 비밀번호" className="w-32" autoComplete="new-password" />
                    <label className="flex items-center gap-1 text-sm">
                      <input type="checkbox" name="active" defaultChecked={a.active} className="size-4" disabled={a.isSelf} /> 활성
                    </label>
                    {a.isSelf ? <span className="pb-1.5 text-xs text-muted-foreground">내 계정</span> : null}
                  </InlineForm>
                  {a.lockedUntil ? <LockNotice id={a.id} until={a.lockedUntil} /> : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default guarded(UsersSettingsPage);
