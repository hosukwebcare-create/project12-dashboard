import { BoardTokenPanel } from "@/components/app/board-token-panel";
import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCtx } from "@/lib/auth/ctx";
import { updateBranchSettingsAction } from "@/modules/settings/actions";
import { boardItemsFor, getBranch } from "@/modules/settings/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "지점 설정" };

async function BranchSettingsPage() {
  const ctx = await getCtx();
  const [branch, items] = await Promise.all([getBranch(ctx), boardItemsFor(ctx)]);
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
            <div className="space-y-1 rounded-md bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">라운딩 하루 표의 열</p>
              <p>{items.map((i) => (i.kind === "round" ? `R1~R${branch.settings.roundsPerDay}` : i.label)).join(" · ")}</p>
              <p>현황판 항목 순서 그대로 나옵니다. 순서와 사용 여부는 &lsquo;현황판 항목&rsquo;에서 바꿉니다. 출석은 따로 적지 않고 라운딩에서 저절로 채워집니다 — 한 번이라도 자리에 있으면 a, 온종일 사유로 없었으면 b.</p>
            </div>
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
