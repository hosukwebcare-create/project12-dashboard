import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCtx } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { cn } from "@/lib/utils";
import { bulkSetSeatFeePlanAction, setSeatFeePlanAction, upsertFeePlanAction } from "@/modules/payments/actions";
import { listFeePlans } from "@/modules/payments/repo";
import { listSeats } from "@/modules/settings/repo";

export const metadata = { title: "요금표" };

const SELECT = "h-8 rounded-md border border-input bg-card px-2 text-sm";
const won = (n: number) => n.toLocaleString("ko-KR");

async function FeesSettingsPage() {
  const ctx = await getCtx();
  const [plans, seats] = await Promise.all([listFeePlans(ctx), listSeats(ctx)]);
  const planById = new Map(plans.map((p) => [p.id, p]));
  const unassigned = seats.filter((s) => !s.feePlanId).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>좌석 등급별 요금 ({plans.length})</CardTitle>
          <CardDescription>
            등록기간이 생기면 이 표로 결제 금액이 자동 계산됩니다. 회원 구분이 성인이면 성인 요금을 씁니다. 요금을 바꿔도 이미 저장한 결제 건의 금액은 그대로입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <InlineForm action={upsertFeePlanAction} submitLabel="추가" className="pb-3">
            <input type="hidden" name="active" value="true" />
            <Input name="name" placeholder="등급 이름 (예: 1인실)" className="w-40" required />
            <Input name="studentPrice" type="number" min={0} placeholder="학생 요금" className="w-32" required />
            <Input name="adultPrice" type="number" min={0} placeholder="성인 요금" className="w-32" required />
            <Input name="sort" type="number" placeholder="순서" className="w-20" defaultValue={plans.length + 1} />
          </InlineForm>
          {plans.map((p) => (
            <InlineForm key={p.id} action={upsertFeePlanAction} className="py-2">
              <input type="hidden" name="id" value={p.id} />
              <Input name="name" defaultValue={p.name} className="w-40" />
              <Input name="studentPrice" type="number" min={0} defaultValue={p.studentPrice} className="w-32" aria-label={`${p.name} 학생 요금`} />
              <Input name="adultPrice" type="number" min={0} defaultValue={p.adultPrice} className="w-32" aria-label={`${p.name} 성인 요금`} />
              <Input name="sort" type="number" defaultValue={p.sort} className="w-20" aria-label={`${p.name} 순서`} />
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="active" defaultChecked={p.active} className="size-4" /> 사용
              </label>
            </InlineForm>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>좌석 등급 지정</CardTitle>
          <CardDescription>
            좌석마다 등급을 붙여야 금액이 계산됩니다.
            {unassigned > 0 ? <b className="text-amber-700"> 아직 {unassigned}개 좌석에 등급이 없습니다.</b> : " 모든 좌석에 등급이 있습니다."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">번호 범위로 한 번에</p>
            <InlineForm action={bulkSetSeatFeePlanAction} submitLabel="일괄 지정">
              <Input name="from" type="number" min={1} placeholder="시작" className="w-24" required aria-label="시작 좌석" />
              <span className="text-sm text-muted-foreground">~</span>
              <Input name="to" type="number" min={1} placeholder="끝" className="w-24" required aria-label="끝 좌석" />
              <select name="feePlanId" className={SELECT} aria-label="일괄 지정할 등급">
                <option value="">등급 없음</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </InlineForm>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {seats.map((s) => {
              const plan = s.feePlanId ? planById.get(s.feePlanId) : undefined;
              return (
                <InlineForm key={s.id} action={setSeatFeePlanAction} submitLabel="저장" className="items-center gap-1.5">
                  <input type="hidden" name="seatId" value={s.id} />
                  <span className="w-14 text-sm tabular-nums">
                    {s.seatNo}번<span className="ml-1 text-xs text-muted-foreground">{s.zone}</span>
                  </span>
                  <select name="feePlanId" defaultValue={s.feePlanId ?? ""} className={cn(SELECT, "flex-1")} aria-label={`${s.seatNo}번 좌석 등급`}>
                    <option value="">등급 없음</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <span className="w-20 text-right text-xs text-muted-foreground tabular-nums">{plan ? `${won(plan.studentPrice)}원` : ""}</span>
                </InlineForm>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default guarded(FeesSettingsPage);
