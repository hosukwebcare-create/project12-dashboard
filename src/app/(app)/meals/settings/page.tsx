import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCtx, MANAGER_ROLES, requireRole } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { updateMealSettingsAction } from "@/modules/meals/actions";
import { getMealSettings } from "@/modules/meals/repo";

export const metadata = { title: "식사 설정" };

async function MealSettingsPage() {
  const ctx = await getCtx();
  requireRole(ctx, ...MANAGER_ROLES);
  const s = await getMealSettings(ctx);
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>식사 설정</CardTitle>
        <CardDescription>단가는 주문 시점에 스냅샷되므로 바꿔도 지난 주문 금액은 유지됩니다.</CardDescription>
      </CardHeader>
      <CardContent>
        <InlineForm action={updateMealSettingsAction} className="flex-col items-stretch">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="lunchPrice">중식 단가</Label>
              <Input id="lunchPrice" name="lunchPrice" type="number" min={0} step={500} defaultValue={s.lunchPrice} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dinnerPrice">석식 단가</Label>
              <Input id="dinnerPrice" name="dinnerPrice" type="number" min={0} step={500} defaultValue={s.dinnerPrice} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cutoffTime">전일 마감 시각</Label>
              <Input id="cutoffTime" name="cutoffTime" type="time" defaultValue={s.cutoffTime} />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="saturdayLunchOnly" defaultChecked={s.saturdayLunchOnly} className="size-4" /> 토요일은 중식만
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="sundayClosed" defaultChecked={s.sundayClosed} className="size-4" /> 일요일 주문 불가
            </label>
          </div>
          <div className="space-y-1">
            <Label htmlFor="closedDates">휴무일 (YYYY-MM-DD, 줄 또는 쉼표로 구분)</Label>
            <Textarea id="closedDates" name="closedDates" rows={3} defaultValue={s.closedDates.join("\n")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="vendorName">도시락 업체</Label>
              <Input id="vendorName" name="vendorName" defaultValue={s.vendorName ?? ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vendorPhone">업체 연락처</Label>
              <Input id="vendorPhone" name="vendorPhone" defaultValue={s.vendorPhone ?? ""} />
            </div>
          </div>
        </InlineForm>
      </CardContent>
    </Card>
  );
}

export default guarded(MealSettingsPage);
