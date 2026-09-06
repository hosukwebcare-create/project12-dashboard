"use client";

import { useState, useTransition } from "react";
import type { MealKind } from "@/db/schema";
import { cn } from "@/lib/utils";
import { toggleOrderAction } from "@/modules/meals/actions";
import type { MealGrid } from "@/modules/meals/repo";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

export function MealGridView({ grid, canOverride }: { grid: MealGrid; canOverride: boolean }) {
  const [rows, setRows] = useState(grid.rows);
  const [totals, setTotals] = useState(grid.totals);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(memberId: string, date: string, meal: MealKind, current: boolean, locked: boolean) {
    let overrideReason: string | undefined;
    if (locked) {
      if (!canOverride) return setError(`${date}는 마감되었습니다 (전일 ${grid.settings.cutoffTime} 이후 변경 불가)`);
      const reason = window.prompt("마감된 날짜입니다. 변경 사유를 입력하세요 (감사 로그에 남습니다)");
      if (!reason?.trim()) return;
      overrideReason = reason.trim();
    }
    const next = !current;
    setError(null);
    setRows((prev) => prev.map((r) => (r.memberId === memberId ? { ...r, orders: { ...r.orders, [date]: { ...(r.orders[date] ?? { lunch: false, dinner: false }), [meal]: next } } } : r)));
    setTotals((prev) => ({ ...prev, [date]: { ...prev[date], [meal]: prev[date][meal] + (next ? 1 : -1) } }));
    start(async () => {
      const res = await toggleOrderAction({ memberId, date, meal, ordered: next, overrideReason });
      if (res.error) {
        setError(res.error);
        setRows((prev) => prev.map((r) => (r.memberId === memberId ? { ...r, orders: { ...r.orders, [date]: { ...(r.orders[date] ?? { lunch: false, dinner: false }), [meal]: current } } } : r)));
        setTotals((prev) => ({ ...prev, [date]: { ...prev[date], [meal]: prev[date][meal] - (next ? 1 : -1) } }));
      }
    });
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {pending ? <p className="text-xs text-muted-foreground">저장 중…</p> : null}
      <div className="overflow-auto rounded-lg border" style={{ maxHeight: "70vh" }}>
        <table className="text-xs" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="sticky left-0 z-20 bg-muted px-2 py-1 text-left" rowSpan={2}>
                좌석 · 이름
              </th>
              {grid.days.map((d) => (
                <th key={d.date} colSpan={2} className={cn("border-l px-1 py-1 text-center font-medium", d.dow === 0 && "text-rose-700", d.dow === 6 && "text-sky-700", d.locked && "bg-muted text-muted-foreground")}>
                  {Number(d.date.slice(8, 10))}
                  <span className="block text-[10px] font-normal">{DOW[d.dow]}</span>
                </th>
              ))}
            </tr>
            <tr>
              {grid.days.map((d) => (
                <MealHeader key={d.date} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.memberId} className="border-t">
                <td className="sticky left-0 z-10 whitespace-nowrap border-t bg-background px-2 py-1 font-medium">
                  <span className="mr-1 tabular-nums text-muted-foreground">{r.seatNo ?? "-"}</span>
                  {r.name}
                </td>
                {grid.days.map((d) => (
                  <Cells key={d.date} day={d} o={r.orders[d.date]} onToggle={(meal, cur) => toggle(r.memberId, d.date, meal, cur, d.locked)} />
                ))}
              </tr>
            ))}
            <tr className="sticky bottom-0 bg-muted font-semibold">
              <td className="sticky left-0 z-10 bg-muted px-2 py-1">합계</td>
              {grid.days.map((d) => (
                <TotalCells key={d.date} t={totals[d.date]} />
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MealHeader() {
  return (
    <>
      <th className="border-l px-1 py-0.5 text-[10px] font-normal text-muted-foreground">중</th>
      <th className="px-1 py-0.5 text-[10px] font-normal text-muted-foreground">석</th>
    </>
  );
}

function Cells({ day, o, onToggle }: { day: MealGrid["days"][number]; o?: { lunch: boolean; dinner: boolean }; onToggle: (meal: MealKind, current: boolean) => void }) {
  const cell = (meal: MealKind, available: boolean) => {
    const on = o?.[meal] ?? false;
    return (
      <td className={cn("border-t border-l px-0.5 py-0.5 text-center", !available && "bg-muted", day.locked && available && "bg-muted/50")}>
        {available ? (
          <button
            type="button"
            onClick={() => onToggle(meal, on)}
            aria-pressed={on}
            aria-label={`${day.date} ${meal === "lunch" ? "중식" : "석식"}`}
            className={cn("size-6 rounded-sm border text-[10px] font-semibold transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border bg-card text-transparent hover:bg-muted", day.locked && "opacity-60")}
          >
            {meal === "lunch" ? "L" : "D"}
          </button>
        ) : (
          <span className="text-muted-foreground">·</span>
        )}
      </td>
    );
  };
  return (
    <>
      {cell("lunch", day.lunch)}
      {cell("dinner", day.dinner)}
    </>
  );
}

function TotalCells({ t }: { t?: { lunch: number; dinner: number } }) {
  return (
    <>
      <td className="border-l px-1 py-1 text-center tabular-nums">{t?.lunch || ""}</td>
      <td className="px-1 py-1 text-center tabular-nums">{t?.dinner || ""}</td>
    </>
  );
}
