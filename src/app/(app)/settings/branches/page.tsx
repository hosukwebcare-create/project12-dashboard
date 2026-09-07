import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCtx, requireRole } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { cn } from "@/lib/utils";
import { createBranchAction, setBranchActiveAction, updateBranchInfoAction } from "@/modules/branches/actions";
import { listBranches } from "@/modules/branches/repo";

export const metadata = { title: "지점 관리" };

async function BranchesPage() {
  const ctx = await getCtx();
  requireRole(ctx, "hq_admin");
  const rows = await listBranches(ctx);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>새 지점</CardTitle>
          <CardDescription>지점 코드는 HERO 연동 등 외부 시스템이 지점을 가리키는 값입니다. 점주는 가맹주이고, 지점장은 그 지점에서 일하는 계정입니다(한 사람이 여러 지점의 점주일 수 있습니다). 좌석은 1번부터 A구역으로 만들어지며 설정 › 좌석에서 구역·번호를 바꿀 수 있습니다. 지점장 계정은 나중에 설정 › 사용자에서 만들어도 됩니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <InlineForm action={createBranchAction} submitLabel="지점 만들기" className="flex-col items-stretch">
            <div className="flex flex-wrap gap-2">
              <Input name="code" placeholder="코드 (예: DT3)" className="w-32" required />
              <Input name="name" placeholder="지점 이름" className="w-40" required />
              <Input name="ownerName" placeholder="점주 (선택)" className="w-32" />
              <Input name="seatCount" type="number" min={0} max={500} defaultValue={50} className="w-28" aria-label="좌석 수" />
              <Input name="roundsPerDay" type="number" min={1} max={24} defaultValue={12} className="w-28" aria-label="하루 회차 수" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Input name="managerLoginId" placeholder="지점장 아이디 (선택)" className="w-44" autoComplete="off" />
              <Input name="managerName" placeholder="지점장 이름" className="w-32" />
              <Input name="managerPassword" type="password" placeholder="비밀번호 (10자+, 영문·숫자)" className="w-56" autoComplete="new-password" />
            </div>
          </InlineForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>지점 목록 ({rows.length})</CardTitle>
          <CardDescription>비활성 지점은 지점 전환 목록에서 빠지고 소속 사용자는 로그인할 수 없습니다. 데이터는 보존됩니다.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {rows.map((b) => (
            <div key={b.id} className={cn("flex flex-wrap items-center gap-3 py-2", !b.active && "opacity-60")}>
              <InlineForm action={updateBranchInfoAction} className="items-center">
                <input type="hidden" name="id" value={b.id} />
                <Input name="code" defaultValue={b.code} className="w-24" aria-label="코드" />
                <Input name="name" defaultValue={b.name} className="w-36" aria-label="이름" />
                <Input name="ownerName" defaultValue={b.ownerName ?? ""} placeholder="점주" className="w-28" aria-label="점주" />
              </InlineForm>
              <span className="text-sm text-muted-foreground">
                좌석 {b.seatCount} · 등록 회원 {b.memberCount} · 회차 {b.roundsPerDay} · 지점장 {b.managerNames.join(", ") || "없음"}
              </span>
              <InlineForm action={setBranchActiveAction} submitLabel={b.active ? "비활성화" : "활성화"} className="ml-auto">
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="active" value={b.active ? "false" : "true"} />
              </InlineForm>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default guarded(BranchesPage);
