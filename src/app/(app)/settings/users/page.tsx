import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { BranchRole } from "@/db/schema";
import { getCtx, ROLE_LABEL } from "@/lib/auth/ctx";
import { fmtDateTime } from "@/lib/format";
import { addUserToBranchAction, removeUserFromBranchAction, unlockUserAction, upsertHqAdminAction, upsertUserAction } from "@/modules/settings/actions";
import { forceLogoutUserAction } from "@/modules/security/actions";
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
            // 다른 지점에도 소속된 계정은 지점장이 이 지점 역할만 바꿀 수 있다(계정 자체는 본사가 고친다)
            const roleEditable = isHq || roles.includes(u.role);
            const editable = isHq || (roleEditable && u.otherBranches.length === 0);
            return (
              <div key={u.id} className="flex flex-wrap items-end gap-x-3 py-2">
                <InlineForm action={upsertUserAction}>
                  <input type="hidden" name="id" value={u.id} />
                  <Input name="loginId" defaultValue={u.loginId} className="w-32" readOnly={!editable} />
                  <Input name="name" defaultValue={u.name} className="w-28" readOnly={!editable} />
                  <select name="role" defaultValue={u.role} className={selectClass} disabled={!roleEditable}>
                    {(roleEditable ? roles : [u.role]).map((r) => (
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
                  {/* 끈 체크박스는 값이 안 가므로, 바꿀 수 없는 칸은 지금 값을 그대로 보낸다 */}
                  {!editable && u.active ? <input type="hidden" name="active" value="on" /> : null}
                </InlineForm>
                {editable && u.active ? (
                  <InlineForm action={forceLogoutUserAction} submitLabel="모든 기기 로그아웃">
                    <input type="hidden" name="userId" value={u.id} />
                  </InlineForm>
                ) : null}
                {u.otherBranches.length ? <span className="pb-1.5 text-xs text-muted-foreground">함께 맡는 지점 {u.otherBranches.join(" · ")}</span> : null}
                {isHq && u.otherBranches.length ? (
                  <InlineForm action={removeUserFromBranchAction} submitLabel="이 지점에서 제외">
                    <input type="hidden" name="id" value={u.id} />
                  </InlineForm>
                ) : null}
                {u.lockedUntil && isHq ? <LockNotice id={u.id} until={u.lockedUntil} /> : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {isHq ? (
        <Card>
          <CardHeader>
            <CardTitle>다른 지점 사용자 추가</CardTitle>
            <CardDescription>
              이미 있는 계정을 {ctx.branchName} 지점에도 소속시킵니다. 한 사람이 여러 지점을 맡을 때 씁니다(예: 점주가 직영 두 곳을 볼 때). 아이디와 비밀번호는 그대로 쓰고, 로그인
              뒤 위쪽에서 지점을 바꿔 가며 봅니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InlineForm action={addUserToBranchAction} submitLabel="이 지점에 추가">
              <Input name="loginId" placeholder="기존 아이디" className="w-40" required autoComplete="off" />
              <select name="role" defaultValue="branch_manager" className={selectClass}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </InlineForm>
          </CardContent>
        </Card>
      ) : null}

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
                  {!a.isSelf && a.active ? (
                    <InlineForm action={forceLogoutUserAction} submitLabel="모든 기기 로그아웃">
                      <input type="hidden" name="userId" value={a.id} />
                    </InlineForm>
                  ) : null}
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
