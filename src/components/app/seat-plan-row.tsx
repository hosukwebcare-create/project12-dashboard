"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { ActionState } from "@/lib/action-utils";
import { cn } from "@/lib/utils";

type Plan = { id: string; name: string; studentPrice: number; adultPrice: number };

type Props = {
  seatId: string;
  seatNo: number;
  zone: string | null;
  feePlanId: string | null;
  plans: Plan[];
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
};

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * 좌석 한 칸의 등급. 고르는 즉시 저장하고, 금액은 고른 등급을 바로 따라간다.
 * 좌석이 77개라 칸마다 저장 버튼을 두면 버튼만 77개가 된다.
 */
export function SeatPlanRow({ seatId, seatNo, zone, feePlanId, plans, action }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(feePlanId ?? "");
  // 일괄 지정처럼 밖에서 등급이 바뀌면 따라간다. key 로 다시 만들면 방금 띄운 "저장됨"까지 사라지므로 값만 맞춘다
  const [synced, setSynced] = useState(feePlanId);
  if (synced !== feePlanId) {
    setSynced(feePlanId);
    setValue(feePlanId ?? "");
  }
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ saved?: boolean; error?: string }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const plan = plans.find((p) => p.id === value);

  function save(next: string) {
    const prev = value;
    setValue(next);
    setResult({});
    if (timer.current) clearTimeout(timer.current);
    start(async () => {
      const fd = new FormData();
      fd.set("seatId", seatId);
      fd.set("feePlanId", next);
      const r = await action({}, fd);
      if (r.error) {
        setValue(prev);
        setResult({ error: r.error });
        return;
      }
      setResult({ saved: true });
      timer.current = setTimeout(() => setResult({}), 4000);
      router.refresh();
    });
  }

  return (
    <tr className="border-t border-border">
      <td className="px-4 py-1.5 whitespace-nowrap tabular-nums">
        {seatNo}번{zone ? <span className="ml-1 text-xs text-muted-foreground">{zone}</span> : null}
      </td>
      <td className="px-2 py-1.5">
        <select
          value={value}
          onChange={(e) => save(e.target.value)}
          disabled={pending}
          aria-label={`${seatNo}번 좌석 등급`}
          className={cn("h-8 w-full min-w-28 rounded-md border border-input bg-card px-2 text-sm", !value && "text-warning")}
        >
          <option value="">등급 없음</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">{plan ? won(plan.studentPrice) : <span className="text-muted-foreground">-</span>}</td>
      <td className={cn("px-2 py-1.5 text-right whitespace-nowrap tabular-nums", plan && plan.adultPrice === 0 && "text-warning")}>
        {plan ? won(plan.adultPrice) : <span className="text-muted-foreground">-</span>}
      </td>
      <td className="w-16 px-2 py-1.5 text-xs whitespace-nowrap" aria-live="polite">
        {pending ? (
          <span className="text-muted-foreground">저장 중…</span>
        ) : result.saved ? (
          <span className="inline-flex items-center gap-1 text-success animate-in fade-in duration-200">
            <Check className="size-3.5" aria-hidden />
            저장됨
          </span>
        ) : result.error ? (
          <span className="text-destructive">{result.error}</span>
        ) : null}
      </td>
    </tr>
  );
}
