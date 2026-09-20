import { BoardTokenPanel } from "@/components/app/board-token-panel";
import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCtx } from "@/lib/auth/ctx";
import { updateBranchSettingsAction } from "@/modules/settings/actions";
import { roundCompanionKeys } from "@/lib/rules/rounding";
import { boardItemsFor, getBranch } from "@/modules/settings/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "지점 설정" };

async function BranchSettingsPage() {
  const ctx = await getCtx();
  const [branch, items] = await Promise.all([getBranch(ctx), boardItemsFor(ctx)]);
  const daily = items.filter((i) => i.kind === "daily");
  const companions = new Set(roundCompanionKeys(branch.settings.roundCompanions, daily.map((i) => i.key)));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>라운딩 · 표시</CardTitle>
          <CardDescription>회차 수와 시간표, 현황판 이름 표시 방식</CardDescription>
        </CardHeader>
        <CardContent>
          <InlineForm action={updateBranchSettingsAction} className="flex-col items-stretch">
            <div className="space-y-1">
              <Label htmlFor="roundsPerDay">하루 회차 수</Label>
              <Input id="roundsPerDay" name="roundsPerDay" type="number" min={1} max={24} defaultValue={branch.settings.roundsPerDay} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="roundSchedule">회차 시간표 (줄 또는 쉼표로 구분)</Label>
              <Textarea id="roundSchedule" name="roundSchedule" rows={4} defaultValue={(branch.settings.roundSchedule ?? []).join(", ")} placeholder="09:00, 10:00, …" />
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">라운딩 돌 때 함께 기록할 항목</legend>
              <p className="text-xs text-muted-foreground">고른 항목은 라운딩 화면의 학생 줄에 같이 나옵니다. 한 번 돌면서 다 적으면 일별 체크를 따로 돌지 않아도 됩니다.</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {daily.map((i) => (
                  <label key={i.key} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="roundCompanions" value={i.key} className="size-4" defaultChecked={companions.has(i.key)} />
                    {i.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="autoAttendance" className="mt-0.5 size-4" defaultChecked={Boolean(branch.settings.autoAttendance)} />
              <span>
                라운딩에서 자리에 있던 학생은 출석으로 자동 처리
                <span className="block text-xs text-muted-foreground">a·b·벌점을 받은 학생만, 출석을 아직 안 적은 경우에만 채웁니다. 부재는 건드리지 않고, 등원 시각·CALL 은 일별 체크에서 고칩니다.</span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="maskNames" className="size-4" defaultChecked={branch.settings.maskNames} />
              현황판에 이름을 마스킹해서 표시 (김*민)
            </label>
          </InlineForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>현황판 링크</CardTitle>
          <CardDescription>매장 모니터에 띄울 주소입니다. 발급하면 이전 링크는 즉시 무효가 됩니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <BoardTokenPanel branchId={ctx.branchId} hasToken={Boolean(branch.boardTokenHash)} />
        </CardContent>
      </Card>
    </div>
  );
}

export default guarded(BranchSettingsPage);
