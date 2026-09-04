import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCtx } from "@/lib/auth/ctx";
import { upsertBoardItemAction } from "@/modules/settings/actions";
import { boardItemsFor } from "@/modules/settings/repo";
import { db } from "@/db/client";
import { boardItems } from "@/db/schema";
import { asc, isNull } from "drizzle-orm";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "현황판 항목" };

async function BoardItemsPage() {
  const ctx = await getCtx();
  const [effective, defaults] = await Promise.all([
    boardItemsFor(ctx, db, true),
    db.select().from(boardItems).where(isNull(boardItems.branchId)).orderBy(asc(boardItems.sort)),
  ]);
  const own = effective.filter((i) => i.branchId !== null);
  const isHq = ctx.role === "hq_admin";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>지점 항목</CardTitle>
          <CardDescription>현황판의 행(출석·플래너·라운딩·영단어·점검완료)입니다. 지점 항목이 있으면 지점 항목만 사용합니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {own.length === 0 ? <p className="mb-2 text-sm text-muted-foreground">지점 항목 없음 (본사 기본 사용 중)</p> : own.map((i) => <ItemRow key={i.id} i={i} editable global={false} />)}
          <div className="mt-3 border-t pt-3">
            <InlineForm action={upsertBoardItemAction} submitLabel="추가">
              <input type="hidden" name="active" value="true" />
              <Input name="key" placeholder="키 (영문)" className="w-32" required />
              <Input name="label" placeholder="표시 이름" className="w-32" required />
              <select name="kind" defaultValue="daily" className="h-8 rounded-md border bg-background px-2 text-sm">
                <option value="daily">일별 항목</option>
                <option value="round">라운딩(회차별)</option>
              </select>
              <Input name="sort" type="number" placeholder="순서" className="w-20" defaultValue={own.length + 1} />
            </InlineForm>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>본사 기본 항목</CardTitle>
          <CardDescription>{isHq ? "전 지점 기본값" : "본사 관리자만 수정"}</CardDescription>
        </CardHeader>
        <CardContent>
          {defaults.map((i) => (
            <ItemRow key={i.id} i={i} editable={isHq} global />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

type ItemRowProps = { i: { id: string; key: string; label: string; kind: "daily" | "round"; sort: number; active: boolean }; editable: boolean; global: boolean };

function ItemRow({ i, editable, global }: ItemRowProps) {
  return (
    <InlineForm action={upsertBoardItemAction} className="border-t py-2 first:border-t-0">
      <input type="hidden" name="id" value={i.id} />
      {global ? <input type="hidden" name="global" value="true" /> : null}
      <Input name="key" defaultValue={i.key} className="w-32" readOnly={!editable} />
      <Input name="label" defaultValue={i.label} className="w-32" readOnly={!editable} />
      <select name="kind" defaultValue={i.kind} className="h-8 rounded-md border bg-background px-2 text-sm" disabled={!editable}>
        <option value="daily">일별 항목</option>
        <option value="round">라운딩(회차별)</option>
      </select>
      <Input name="sort" type="number" defaultValue={i.sort} className="w-20" readOnly={!editable} />
      <label className="flex items-center gap-1 text-sm">
        <input type="checkbox" name="active" defaultChecked={i.active} className="size-4" disabled={!editable} /> 사용
      </label>
    </InlineForm>
  );
}

export default guarded(BoardItemsPage);
