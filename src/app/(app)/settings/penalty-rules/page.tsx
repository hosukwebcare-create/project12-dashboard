import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCtx } from "@/lib/auth/ctx";
import { upsertPenaltyRuleAction } from "@/modules/settings/actions";
import { listPenaltyRulesForSettings } from "@/modules/settings/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "벌점 규칙" };

async function PenaltyRulesPage() {
  const ctx = await getCtx();
  const rules = await listPenaltyRulesForSettings(ctx);
  const defaults = rules.filter((r) => r.branchId === null);
  const own = rules.filter((r) => r.branchId !== null);
  const isHq = ctx.role === "hq_admin";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>지점 규칙</CardTitle>
          <CardDescription>지점 규칙이 하나라도 있으면 이 지점은 지점 규칙만 사용합니다. 없으면 본사 기본 규칙을 씁니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {own.length === 0 ? <p className="mb-2 text-sm text-muted-foreground">지점 규칙 없음 (본사 기본 사용 중)</p> : own.map((r) => <RuleRow key={r.id} r={r} editable global={false} />)}
          <div className="mt-3 border-t pt-3">
            <p className="mb-1 text-xs text-muted-foreground">새 지점 규칙</p>
            <InlineForm action={upsertPenaltyRuleAction} submitLabel="추가">
              <Input name="name" placeholder="규칙 이름" className="w-44" required />
              <Input name="points" type="number" min={0} placeholder="점수" className="w-20" required />
              <Input name="sort" type="number" placeholder="순서" className="w-20" defaultValue={own.length + 1} />
              <input type="hidden" name="active" value="true" />
            </InlineForm>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>본사 기본 규칙</CardTitle>
          <CardDescription>{isHq ? "전 지점에 적용되는 기본값입니다." : "본사 관리자만 수정할 수 있습니다."}</CardDescription>
        </CardHeader>
        <CardContent>
          {defaults.map((r) => (
            <RuleRow key={r.id} r={r} editable={isHq} global />
          ))}
          {isHq ? (
            <div className="mt-3 border-t pt-3">
              <InlineForm action={upsertPenaltyRuleAction} submitLabel="기본 규칙 추가">
                <input type="hidden" name="global" value="true" />
                <input type="hidden" name="active" value="true" />
                <Input name="name" placeholder="규칙 이름" className="w-44" required />
                <Input name="points" type="number" min={0} placeholder="점수" className="w-20" required />
                <Input name="sort" type="number" placeholder="순서" className="w-20" defaultValue={defaults.length + 1} />
              </InlineForm>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

type RuleRowProps = { r: { id: string; name: string; points: number; sort: number; active: boolean }; editable: boolean; global: boolean };

function RuleRow({ r, editable, global }: RuleRowProps) {
  return (
    <InlineForm action={upsertPenaltyRuleAction} className="border-t py-2 first:border-t-0">
      <input type="hidden" name="id" value={r.id} />
      {global ? <input type="hidden" name="global" value="true" /> : null}
      <Input name="name" defaultValue={r.name} className="w-44" readOnly={!editable} />
      <Input name="points" type="number" min={0} defaultValue={r.points} className="w-20" readOnly={!editable} />
      <Input name="sort" type="number" defaultValue={r.sort} className="w-20" readOnly={!editable} />
      <label className="flex items-center gap-1 text-sm">
        <input type="checkbox" name="active" defaultChecked={r.active} className="size-4" disabled={!editable} /> 사용
      </label>
    </InlineForm>
  );
}

export default guarded(PenaltyRulesPage);
