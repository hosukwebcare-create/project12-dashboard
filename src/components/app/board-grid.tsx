"use client";

import { useEffect, useState } from "react";
import type { BoardData } from "@/modules/board/repo";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const COLORS: Record<string, string> = {
  a: "#57BB8A",
  b: "#B7E1A1",
  p: "#E53935",
  na: "#E5E7EB",
};

function dayLabel(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return `${m}/${d}(${DOW[new Date(y, m - 1, d).getDay()]})`;
}

export function BoardGrid({ branchId, token, initial, refreshMs = 60000 }: { branchId: string; token: string; initial: BoardData; refreshMs?: number }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/board/${branchId}?t=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status}`);
        const next = (await res.json()) as BoardData;
        if (alive) {
          setData(next);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "갱신 실패");
      }
    };
    const id = setInterval(tick, refreshMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [branchId, token, refreshMs]);

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  }

  const rounds = Array.from({ length: data.roundsPerDay }, (_, i) => i + 1);
  const rowsPerDay: { key: string; roundNo: number; label: string }[] = [];
  for (const item of data.items) {
    if (item.kind === "round") rounds.forEach((n) => rowsPerDay.push({ key: item.key, roundNo: n, label: `R${n}` }));
    else rowsPerDay.push({ key: item.key, roundNo: 0, label: item.label });
  }
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const visibleDays = data.days.filter((d) => d <= todayKey);
  const cellW = data.seats.length > 40 ? 26 : data.seats.length > 25 ? 32 : 40;

  return (
    <div className="board" style={{ ["--cw" as string]: `${cellW}px` }}>
      <style>{`
        .board { font-family: system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; color: #111; }
        .board table { border-collapse: collapse; table-layout: fixed; }
        .board th, .board td { border: 1px solid #d1d5db; text-align: center; font-size: 12px; height: 22px; padding: 0; }
        .board td.cell { width: var(--cw); min-width: var(--cw); }
        .board .sticky-l { position: sticky; left: 0; background: #fff; z-index: 2; }
        .board .sticky-l2 { position: sticky; left: 40px; background: #fff; z-index: 2; }
        .board .hdr { position: sticky; top: 0; background: #fff; z-index: 3; }
        .board .name { writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 1px; height: 64px; font-weight: 600; font-size: 12px; }
        .board .day { background: #f3f4f6; font-weight: 700; text-align: left; padding-left: 6px; }
        .board .pts { font-weight: 700; color: #b91c1c; background: #fff7ed; }
      `}</style>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="text-lg font-bold">
          {data.branchName} 생활관리 현황 · {dayLabel(data.days[0])} ~ {dayLabel(data.days[6])}
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <span>{data.rules.map((r) => `${r.name}[${r.points}점]`).join(" / ")}</span>
          <span className="text-xs text-gray-400">갱신 {new Date(data.generatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
          {error ? <span className="text-rose-700">갱신 실패</span> : null}
          <button type="button" onClick={toggleFullscreen} className="rounded border px-2 py-0.5 text-xs hover:bg-gray-100 print:hidden">
            전체화면
          </button>
        </div>
      </div>
      <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 56px)" }}>
        <table>
          <thead className="hdr">
            <tr>
              <th className="sticky-l" style={{ width: 40 }}></th>
              <th className="sticky-l2" style={{ width: 72 }}>벌점 합계</th>
              {data.seats.map((s) => (
                <td key={s.seatNo} className={`cell ${s.weeklyPoints > 0 ? "pts" : ""}`}>
                  {s.weeklyPoints || ""}
                </td>
              ))}
            </tr>
            <tr>
              <th className="sticky-l"></th>
              <th className="sticky-l2">좌석</th>
              {data.seats.map((s) => (
                <th key={s.seatNo} className="cell">
                  {s.seatNo}
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky-l"></th>
              <th className="sticky-l2">이름</th>
              {data.seats.map((s) => (
                <th key={s.seatNo} className="cell">
                  <div className="name">{s.name}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleDays.map((day) => (
              <Frag key={day}>
                <tr>
                  <td className="day sticky-l" colSpan={2} style={{ left: 0 }}>
                    {dayLabel(day)}
                  </td>
                  {data.seats.map((s) => (
                    <td key={s.seatNo} className="cell" style={{ background: "#f3f4f6" }} />
                  ))}
                </tr>
                {rowsPerDay.map((row) => (
                  <tr key={`${day}-${row.key}-${row.roundNo}`}>
                    <td className="sticky-l" />
                    <td className="sticky-l2" style={{ fontWeight: 600 }}>
                      {row.label}
                    </td>
                    {data.seats.map((s) => {
                      const c = data.cells[`${s.seatNo}|${day}|${row.key}|${row.roundNo}`];
                      return (
                        <td key={s.seatNo} className="cell" style={{ background: c ? COLORS[c.grade] : "#fff", color: c?.grade === "p" ? "#fff" : "#111", fontWeight: 700 }}>
                          {c?.grade === "p" ? c.points : c?.grade === "b" ? "·" : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Frag>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Frag({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
