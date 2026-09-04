import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCtx } from "@/lib/auth/ctx";
import { listSeatsWithOccupant } from "@/modules/members/repo";
import { bulkCreateSeatsAction, upsertSeatAction } from "@/modules/settings/actions";
import { listSeats } from "@/modules/settings/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "좌석" };

async function SeatsSettingsPage() {
  const ctx = await getCtx();
  const [seats, occupancy] = await Promise.all([listSeats(ctx), listSeatsWithOccupant(ctx)]);
  const occ = new Map(occupancy.map((o) => [o.seatId, o.memberName]));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>좌석 일괄 추가</CardTitle>
          <CardDescription>이미 있는 번호는 건너뜁니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <InlineForm action={bulkCreateSeatsAction} submitLabel="추가">
            <Input name="from" type="number" min={1} placeholder="시작" className="w-24" required />
            <Input name="to" type="number" min={1} placeholder="끝" className="w-24" required />
            <Input name="zone" placeholder="구역 (A)" className="w-24" defaultValue="A" />
          </InlineForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>좌석 목록 ({seats.length})</CardTitle>
          <CardDescription>구역은 라운딩 목록의 그룹 기준입니다. 사용 안 함으로 바꿔도 배정된 회원은 유지됩니다.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {seats.map((s) => (
            <InlineForm key={s.id} action={upsertSeatAction} className="py-2">
              <input type="hidden" name="id" value={s.id} />
              <Input name="seatNo" type="number" min={1} defaultValue={s.seatNo} className="w-20" />
              <Input name="zone" defaultValue={s.zone} className="w-20" />
              <Input name="sort" type="number" defaultValue={s.sort} className="w-20" />
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="active" defaultChecked={s.active} className="size-4" /> 사용
              </label>
              <span className="w-24 text-sm text-muted-foreground">{occ.get(s.id) ?? "빈 좌석"}</span>
            </InlineForm>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default guarded(SeatsSettingsPage);
