import { InlineForm } from "@/components/app/inline-form";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCtx, ROLE_LABEL } from "@/lib/auth/ctx";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { describeUserAgent } from "@/lib/rules/user-agent";
import { changeOwnPasswordAction, logoutOtherDevicesAction } from "@/modules/security/actions";
import { listActiveSessions } from "@/modules/security/sessions";

export const metadata = { title: "내 계정" };
export const dynamic = "force-dynamic";

/** 모든 직원: 내 비밀번호 바꾸기, 지금 로그인된 기기 보기·끊기 */
async function AccountPage() {
  const ctx = await getCtx();
  const sessions = await listActiveSessions(ctx.userId, ctx.sessionId ?? null);
  const others = sessions.filter((s) => !s.current).length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="내 계정" description={`${ctx.userName} · ${ROLE_LABEL[ctx.role]}`} />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>비밀번호 바꾸기</CardTitle>
            <CardDescription>영문과 숫자를 섞어 10자 이상. 관리자가 정해 준 첫 비밀번호는 바로 바꾸세요. 바꾸면 이 기기를 뺀 다른 기기는 모두 로그아웃됩니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <InlineForm action={changeOwnPasswordAction} submitLabel="비밀번호 바꾸기" className="gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="current">지금 비밀번호</Label>
                <Input id="current" name="current" type="password" autoComplete="current-password" required className="w-48" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="next">새 비밀번호</Label>
                <Input id="next" name="next" type="password" autoComplete="new-password" required minLength={10} className="w-48" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">새 비밀번호 확인</Label>
                <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} className="w-48" />
              </div>
            </InlineForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>로그인된 기기 ({sessions.length})</CardTitle>
            <CardDescription>모르는 기기가 있거나 휴대폰을 잃어버렸다면 다른 기기를 모두 로그아웃하고 비밀번호를 바꾸세요.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="divide-y rounded-md border">
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
                  <span className="font-medium">
                    {describeUserAgent(s.userAgent)}
                    {s.method === "pin" ? <span className="ml-2 text-xs text-muted-foreground">PIN 전환</span> : null}
                    {s.current ? <span className="ml-2 rounded-sm bg-card px-1.5 py-0.5 text-xs text-primary ring-1 ring-primary/30">이 기기</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {s.ip ?? "IP 없음"} · 로그인 {fmtDateTime(s.createdAt)} · 마지막 사용 {fmtRelative(s.lastSeenAt)}
                  </span>
                </li>
              ))}
            </ul>
            {others > 0 ? (
              <InlineForm action={logoutOtherDevicesAction} submitLabel={`다른 기기 ${others}대 로그아웃`} />
            ) : (
              <p className="text-sm text-muted-foreground">다른 기기에는 로그인되어 있지 않습니다.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default guarded(AccountPage);
