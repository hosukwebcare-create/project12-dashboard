import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getCtx, requireRole } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { upsertTemplateAction } from "@/modules/alimtalk/actions";
import { listTemplates } from "@/modules/alimtalk/repo";

export const metadata = { title: "알림톡 템플릿" };

async function AlimtalkTemplatesPage() {
  const ctx = await getCtx();
  requireRole(ctx, "hq_admin");
  const templates = await listTemplates(ctx, undefined, true);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>새 템플릿</CardTitle>
          <CardDescription>카카오 비즈메시지에 승인받은 템플릿 코드와 본문을 그대로 넣습니다. 변수는 #{"{이름}"} 형식이며 이름·지점·좌석은 자동으로 채워집니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <InlineForm action={upsertTemplateAction} submitLabel="추가" className="flex-col items-stretch">
            <input type="hidden" name="active" value="true" />
            <div className="flex flex-wrap gap-2">
              <Input name="code" placeholder="템플릿 코드 (예: WEEKLY_REPORT)" className="w-56" required />
              <Input name="name" placeholder="표시 이름" className="w-56" required />
            </div>
            <Textarea name="body" rows={4} placeholder={"#{이름}님, #{지점} 주간리포트가 도착했습니다.\n#{링크}"} required />
          </InlineForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>템플릿 목록 ({templates.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {templates.length === 0 ? <p className="text-sm text-muted-foreground">등록된 템플릿이 없습니다</p> : null}
          {templates.map((t) => (
            <InlineForm key={t.id} action={upsertTemplateAction} className="flex-col items-stretch py-3">
              <input type="hidden" name="id" value={t.id} />
              <div className="flex flex-wrap items-center gap-2">
                <Input name="code" defaultValue={t.code} className="w-56" />
                <Input name="name" defaultValue={t.name} className="w-56" />
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="active" defaultChecked={t.active} className="size-4" /> 사용
                </label>
                <span className="text-xs text-muted-foreground">변수: {t.variables.length ? t.variables.map((v) => `#{${v}}`).join(" ") : "없음"}</span>
              </div>
              <Textarea name="body" defaultValue={t.body} rows={3} />
            </InlineForm>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default guarded(AlimtalkTemplatesPage);
