import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCtx, requireRole } from "@/lib/auth/ctx";
import { CUSTOM_FIELD_TYPE_LABEL, CUSTOM_FIELD_TYPES } from "@/lib/rules/custom-fields";
import { upsertCustomFieldDefAction } from "@/modules/settings/actions";
import { CUSTOM_FIELD_ENTITY_LABEL, listCustomFieldDefs, type CustomFieldEntity } from "@/modules/settings/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "커스텀 필드" };

const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";
const ENTITIES: CustomFieldEntity[] = ["member", "issue"];

function TypeSelect({ name, value, disabled }: { name: string; value?: string; disabled?: boolean }) {
  return (
    <select name={name} defaultValue={value ?? "text"} className={selectClass} disabled={disabled}>
      {CUSTOM_FIELD_TYPES.map((t) => (
        <option key={t} value={t}>
          {CUSTOM_FIELD_TYPE_LABEL[t]}
        </option>
      ))}
    </select>
  );
}

async function CustomFieldsPage() {
  const ctx = await getCtx();
  requireRole(ctx, "hq_admin");
  const defs = await listCustomFieldDefs(ctx);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>새 필드</CardTitle>
          <CardDescription>회원 등록·수정 양식과 이슈 등록 양식에 개발 없이 항목을 추가합니다. 선택형은 선택지를 쉼표로 구분합니다. 전 지점에 적용됩니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <InlineForm action={upsertCustomFieldDefAction} submitLabel="추가">
            <input type="hidden" name="active" value="true" />
            <select name="entity" defaultValue="member" className={selectClass}>
              {ENTITIES.map((e) => (
                <option key={e} value={e}>
                  {CUSTOM_FIELD_ENTITY_LABEL[e]}
                </option>
              ))}
            </select>
            <Input name="key" placeholder="키 (영문)" className="w-32" required />
            <Input name="label" placeholder="표시 이름" className="w-32" required />
            <TypeSelect name="type" />
            <Input name="options" placeholder="선택지 (쉼표)" className="w-44" />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="required" className="size-4" /> 필수
            </label>
            <Input name="sort" type="number" placeholder="순서" className="w-20" defaultValue={defs.length + 1} />
          </InlineForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>필드 목록 ({defs.length})</CardTitle>
          <CardDescription>삭제 대신 사용 해제로 숨깁니다. 기존 값은 보존됩니다.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {defs.length === 0 ? <p className="text-sm text-muted-foreground">정의된 필드가 없습니다</p> : null}
          {defs.map((d) => (
            <InlineForm key={d.id} action={upsertCustomFieldDefAction} className="py-2">
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="entity" value={d.entity} />
              <span className="w-16 text-sm text-muted-foreground">{CUSTOM_FIELD_ENTITY_LABEL[d.entity as CustomFieldEntity] ?? d.entity}</span>
              <Input name="key" defaultValue={d.key} className="w-32" />
              <Input name="label" defaultValue={d.label} className="w-32" />
              <TypeSelect name="type" value={d.type} />
              <Input name="options" defaultValue={d.options.join(", ")} className="w-44" placeholder="선택지 (쉼표)" />
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="required" defaultChecked={d.required} className="size-4" /> 필수
              </label>
              <Input name="sort" type="number" defaultValue={d.sort} className="w-20" />
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="active" defaultChecked={d.active} className="size-4" /> 사용
              </label>
            </InlineForm>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default guarded(CustomFieldsPage);
