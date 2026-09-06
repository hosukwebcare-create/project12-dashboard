"use client";

import { useEffect, useState } from "react";
import type { BoardData } from "@/modules/board/repo";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 매장 모니터용 색. 멀리서도 구분되어야 하므로 채도는 유지하되 앱 팔레트(잉크·종이)와 같은 계열로 맞춘다.
 * a 양호 = 짙은 초록, b 사유 = 연두, p 벌점 = 장미, na 부재 = 종이색 회색
 */
const COLORS: Record<string, { bg: string; fg: string }> = {
  a: { bg: "oklch(0.66 0.13 158)", fg: "#fff" },
  b: { bg: "oklch(0.9 0.12 125)", fg: "oklch(0.32 0.06 125)" },
  p: { bg: "oklch(0.58 0.19 22)", fg: "#fff" },
  na: { bg: "oklch(0.9 0.006 85)", fg: "oklch(0.45 0.02 262)" },
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
        .board { color: oklch(0.22 0.02 262); }
        .board table { border-collapse: collapse; table-layout: fixed; }
        .board th, .board td { border: 1px solid oklch(0.9 0.008 85); text-align: center; font-size: 12px; height: 22px; padding: 0; }
        .board td.cell { width: var(--cw); min-width: var(--cw); }
        .board .sticky-l { position: sticky; left: 0; background: #fff; z-index: 2; }
        .board .sticky-l2 { position: sticky; left: 40px; background: #fff; z-index: 2; }
        .board .hdr { position: sticky; top: 0; background: #fff; z-index: 3; }
        .board .hdr th { color: oklch(0.5 0.02 262); font-weight: 500; }
        .board .name { writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 1px; height: 64px; font-weight: 600; font-size: 12px; color: oklch(0.22 0.02 262); }
        .board .day { background: oklch(0.955 0.007 85); font-weight: 600; text-align: left; padding-left: 8px; color: oklch(0.35 0.02 262); }
        .board .pts { font-weight: 700; color: oklch(0.5 0.19 22); background: oklch(0.97 0.02 22); }
        .board .lbl { font-weight: 500; color: oklch(0.45 0.02 262); }
      `}</style>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-border px-1 pb-2">
        <div>
          <div className="text-lg font-semibold tracking-tight">{data.branchName} 생활관리 현황</div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            {dayLabel(data.days[0])} ~ {dayLabel(data.days[6])} · {data.rules.map((r) => `${r.name} ${r.points}점`).join(" · ")}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>갱신 {new Date(data.generatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
          {error ? <span className="text-rose-700">갱신 실패</span> : null}
          <button type="button" onClick={toggleFullscreen} className="rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted print:hidden">
            전체화면
          </button>
        </div>
      </div>
      <div className="overflow-auto rounded-lg border border-border bg-card" style={{ maxHeight: "calc(100vh - 72px)" }}>
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
                    <td key={s.seatNo} className="cell" style={{ background: "oklch(0.955 0.007 85)" }} />
                  ))}
                </tr>
                {rowsPerDay.map((row) => (
                  <tr key={`${day}-${row.key}-${row.roundNo}`}>
                    <td className="sticky-l" />
                    <td className="sticky-l2 lbl">{row.label}</td>
                    {data.seats.map((s) => {
                      const c = data.cells[`${s.seatNo}|${day}|${row.key}|${row.roundNo}`];
                      const color = c ? COLORS[c.grade] : null;
                      return (
                        <td key={s.seatNo} className="cell" style={{ background: color?.bg ?? "#fff", color: color?.fg ?? "inherit", fontWeight: 700 }}>
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
