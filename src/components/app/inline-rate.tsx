"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** 월 집계 표의 시급 칸. 설정 화면으로 가지 않고 그 자리에서 고친다 — 칸을 벗어나면 저장된다 */
export function InlineRate({ userId, name, value, save }: { userId: string; name: string; value: number | null; save: (input: { userId: string; hourlyRate: string }) => Promise<{ ok?: boolean; error?: string }> }) {
  const [v, setV] = useState(value === null ? "" : String(value));
  const [state, setState] = useState<{ error?: string; ok?: boolean }>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-end">
      <input
        className="h-8 w-24 rounded-md border border-input bg-card px-2 text-right text-sm tabular-nums placeholder:text-muted-foreground"
        value={v}
        inputMode="numeric"
        placeholder="시급"
        aria-label={`${name} 시급`}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        onBlur={() => {
          if (v.replace(/[,\s원]/g, "") === (value === null ? "" : String(value))) return;
          startTransition(async () => {
            const res = await save({ userId, hourlyRate: v });
            setState(res);
            // 예상 급여가 새 시급을 따라가도록 표를 다시 읽는다
            if (res.ok) router.refresh();
          });
        }}
      />
      <span className="text-[11px] text-muted-foreground" aria-live="polite">
        {pending ? "저장 중…" : state.error ? <span className="text-destructive">{state.error}</span> : state.ok ? "저장됨" : ""}
      </span>
    </span>
  );
}
