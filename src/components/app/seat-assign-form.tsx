"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-utils";
import { assignSeatAction } from "@/modules/members/actions";
import type { SeatOccupancy } from "@/modules/members/repo";

export function SeatAssignForm({ memberId, currentSeatId, seats }: { memberId: string; currentSeatId: string | null; seats: SeatOccupancy[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(assignSeatAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={memberId} />
      <div className="flex gap-2">
        <select name="seatId" defaultValue={currentSeatId ?? ""} className="h-9 flex-1 rounded-md border bg-background px-3 text-sm">
          <option value="">미배정</option>
          {seats.map((s) => (
            <option key={s.seatId} value={s.seatId} disabled={Boolean(s.memberId) && s.memberId !== memberId}>
              {s.seatNo}번 ({s.zone}){s.memberName && s.memberId !== memberId ? ` · ${s.memberName}` : ""}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "저장 중…" : "배정"}
        </Button>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-700">좌석을 변경했습니다</p> : null}
    </form>
  );
}
