"use client";

import { AlertTriangle } from "lucide-react";
import { useState, useTransition } from "react";
import type { StaffGroup } from "@/db/schema";
import { EMPLOYMENT_TYPES, employmentLabel, formatHours, slotsForAudience, STAFF_GROUPS, staffGroupOf } from "@/lib/rules/worklog";
import { cn } from "@/lib/utils";

export type GridSlot = { key: string; label: string; audience: string | null; weekend: boolean; minutes: number | null; hours: number; startTime: string; endTime: string; active: boolean };
export type GridRow = {
  userId: string;
  name: string;
  /** 계정 역할. 근무 형태를 바꾸면 직군을 화면에서 바로 다시 정한다 */
  role: string;
  employmentType: string;
  workDays: string | null;
  group: StaffGroup;
  former: boolean;
  logId: string | null;
  slotKeys: string[];
  hoursX100: number;
  overtimeX100: number;
  overtimeReason: string | null;
  /** 출근~퇴근 버튼 시각 "09:02 ~ 15:10" */
  clock: string | null;
  confirmedBy: string | null;
};
type LogResult = { log?: { id: string; slotKeys: string[]; hoursX100: number; overtimeX100: number; overtimeReason: string | null; locked: boolean }; error?: string };

type Props = {
  date: string;
  sunday: boolean;
  rows: GridRow[];
  slots: GridSlot[];
  isHq: boolean;
  patchLog: (input: { userId: string; date: string; slotKeys?: string[]; overtime?: string; overtimeReason?: string | null }) => Promise<LogResult>;
  patchStaff: (input: { userId: string; employmentType?: string; workDays?: string }) => Promise<{ ok?: boolean; error?: string }>;
  confirm: (fd: FormData) => Promise<void>;
};

const FIELD = "h-8 w-full rounded-md border border-input bg-card px-2 text-sm placeholder:text-muted-foreground disabled:opacity-60";
const minutesOf = (s: GridSlot) => s.minutes ?? Math.round((s.hours / 100) * 60);

/**
 * 일별 현황 표. 시트의 하루 탭처럼 근무자 한 줄에 근무 형태·근무 요일·타임 체크·근무시간·초과근무·사유·본사확인이 다 있다.
 * 설정 화면으로 가지 않고 이 줄에서 바로 고친다 — 체크하면 곧바로 저장되고 근무시간이 다시 계산된다.
 */
export function WorkDayGrid({ date, sunday, rows: initial, slots, isHq, patchLog, patchStaff, confirm }: Props) {
  const toDrafts = (list: GridRow[]) => Object.fromEntries(list.map((r) => [r.userId, { ot: r.overtimeX100 ? formatHours(r.overtimeX100) : "", reason: r.overtimeReason ?? "" }]));
  const [rows, setRows] = useState(initial);
  // 초과근무 시간과 사유는 둘이 같이 있어야 저장된다. 입력 중인 값은 여기에 둔다
  const [drafts, setDrafts] = useState<Record<string, { ot: string; reason: string }>>(() => toDrafts(initial));
  // 본사 확인처럼 서버에서 새로 그려 오면(목록이 바뀌면) 그 값으로 맞춘다
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) {
    setSynced(initial);
    setRows(initial);
    setDrafts(toDrafts(initial));
  }
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = slots.filter((s) => s.active);

  function update(userId: string, patch: Partial<GridRow>) {
    setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, ...patch } : r)));
  }

  function saveLog(row: GridRow, patch: { slotKeys?: string[]; overtime?: string; overtimeReason?: string | null }, what: string) {
    setError(null);
    startTransition(async () => {
      const res = await patchLog({ userId: row.userId, date, ...patch });
      if (res.error || !res.log) {
        setError(`${row.name}: ${res.error ?? "저장하지 못했습니다"}`);
        update(row.userId, { slotKeys: row.slotKeys });
        return;
      }
      update(row.userId, { logId: res.log.id, slotKeys: res.log.slotKeys, hoursX100: res.log.hoursX100, overtimeX100: res.log.overtimeX100, overtimeReason: res.log.overtimeReason });
      setSaved(`${row.name} ${what} 저장됨`);
    });
  }

  function saveStaff(row: GridRow, patch: { employmentType?: string; workDays?: string }) {
    setError(null);
    startTransition(async () => {
      const res = await patchStaff({ userId: row.userId, ...patch });
      if (res.error) setError(`${row.name}: ${res.error}`);
      else setSaved(`${row.name} ${patch.employmentType ? "근무 형태" : "근무 요일"} 저장됨`);
    });
  }

  function toggle(row: GridRow, key: string, on: boolean) {
    const next = on ? [...row.slotKeys, key] : row.slotKeys.filter((k) => k !== key);
    update(row.userId, { slotKeys: next });
    saveLog(row, { slotKeys: next }, "타임");
  }

  function saveOvertime(row: GridRow) {
    const d = drafts[row.userId];
    const savedOt = row.overtimeX100 ? formatHours(row.overtimeX100) : "";
    if (d.ot.trim() === savedOt && d.reason.trim() === (row.overtimeReason ?? "")) return;
    if (d.ot.trim() && Number(d.ot) > 0 && !d.reason.trim()) {
      setError(`${row.name}: 초과근무 사유를 적으면 함께 저장됩니다`);
      return;
    }
    saveLog(row, { overtime: d.ot.trim(), overtimeReason: d.reason }, "초과근무");
  }

  const groups = STAFF_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r.group === g.key) })).filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-3">
      <p className="min-h-5 text-xs" aria-live="polite">
        {error ? (
          <span className="inline-flex items-center gap-1 text-destructive" role="alert">
            <AlertTriangle className="size-3.5" aria-hidden /> {error}
          </span>
        ) : pending ? (
          <span className="text-muted-foreground">저장 중…</span>
        ) : saved ? (
          <span className="text-muted-foreground">{saved}</span>
        ) : (
          <span className="text-muted-foreground">체크하면 바로 저장됩니다. 근무 형태·근무 요일·초과근무도 이 표에서 고칩니다.</span>
        )}
      </p>
      {groups.map((g) => {
        // 이 직군 사람들이 그날 쓰는 타임만 열로 둔다. 같은 근무 형태끼리는 칸이 같은 자리에 온다(시트처럼)
        const cols = active.filter((s) => s.weekend === sunday && g.rows.some((r) => s.audience === null || s.audience === r.employmentType));
        const extra = slots.filter((s) => !cols.includes(s) && g.rows.some((r) => r.slotKeys.includes(s.key)));
        const shown = [...cols, ...extra];
        return (
          <section key={g.key} className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <caption className="border-b border-border bg-muted/60 px-3 py-1.5 text-left text-xs font-semibold">
                {g.label}
                <span className="ml-2 font-normal text-muted-foreground">
                  {g.rows.length}명 · 기록 {g.rows.filter((r) => r.slotKeys.length || r.overtimeX100).length}명
                </span>
              </caption>
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">
                    근무자
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                    근무 형태
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                    근무 요일
                  </th>
                  {shown.map((s) => (
                    <th key={s.key} scope="col" className="px-1 py-1.5 text-center font-medium whitespace-nowrap" title={`${s.audience ?? "공통"} · ${minutesOf(s)}분${s.startTime ? ` · ${s.startTime}~${s.endTime}` : ""}`}>
                      {s.label}
                      <span className="block text-[10px] font-normal tabular-nums">{s.startTime ? `${s.startTime}~${s.endTime}` : `${minutesOf(s)}분`}</span>
                    </th>
                  ))}
                  {shown.length === 0 ? (
                    <th scope="col" className="min-w-64 px-2 py-1.5 text-left font-medium">
                      타임
                    </th>
                  ) : null}
                  <th scope="col" className="px-2 py-1.5 text-right font-medium whitespace-nowrap">
                    근무시간
                  </th>
                  <th scope="col" className="w-20 px-2 py-1.5 text-right font-medium whitespace-nowrap">
                    초과근무
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    사유
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                    본사확인
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium whitespace-nowrap">
                    총 근무시간
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => {
                  const locked = Boolean(r.confirmedBy);
                  const mine = new Set(slotsForAudience(active, r.employmentType, sunday).map((s) => s.key));
                  const typeOptions: string[] = [...EMPLOYMENT_TYPES];
                  if (!typeOptions.includes(r.employmentType)) typeOptions.push(r.employmentType);
                  const d = drafts[r.userId] ?? { ot: "", reason: "" };
                  return (
                    <tr key={r.userId} className="border-b border-border last:border-b-0">
                      <th scope="row" className="px-3 py-1.5 text-left font-medium whitespace-nowrap">
                        {r.name}
                        {r.clock ? <span className="block text-[11px] font-normal text-muted-foreground tabular-nums">{r.clock}</span> : null}
                        {r.former ? <span className="block text-[11px] font-normal text-muted-foreground">지점에서 빠진 사람</span> : null}
                      </th>
                      <td className="px-2 py-1.5">
                        <select
                          className={cn(FIELD, "min-w-40")}
                          value={r.employmentType}
                          disabled={r.former}
                          aria-label={`${r.name} 근무 형태`}
                          onChange={(e) => {
                            update(r.userId, { employmentType: e.target.value, group: staffGroupOf(r.role, e.target.value) });
                            saveStaff(r, { employmentType: e.target.value });
                          }}
                        >
                          {typeOptions.map((t) => (
                            <option key={t} value={t}>
                              {employmentLabel(t)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className={cn(FIELD, "min-w-24")}
                          defaultValue={r.workDays ?? ""}
                          placeholder="월~금"
                          disabled={r.former}
                          aria-label={`${r.name} 근무 요일`}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v === (r.workDays ?? "")) return;
                            update(r.userId, { workDays: v || null });
                            saveStaff(r, { workDays: v });
                          }}
                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        />
                      </td>
                      {shown.map((s) => {
                        const usable = mine.has(s.key) || r.slotKeys.includes(s.key);
                        return (
                          <td key={s.key} className={cn("px-1 py-1.5 text-center", !usable && "bg-muted/50")}>
                            {usable ? (
                              <input
                                type="checkbox"
                                className="size-5 accent-primary"
                                checked={r.slotKeys.includes(s.key)}
                                disabled={locked}
                                aria-label={`${r.name} ${s.label}`}
                                onChange={(e) => toggle(r, s.key, e.target.checked)}
                              />
                            ) : null}
                          </td>
                        );
                      })}
                      {shown.length === 0 ? (
                        <td className="min-w-64 px-2 py-1.5 text-xs text-muted-foreground">
                          이 형태의 타임이 없습니다 ·{" "}
                          <a href="/worklog/settings" className="underline underline-offset-2">
                            타임·직원 설정
                          </a>
                          에서 만드세요
                        </td>
                      ) : null}
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatHours(r.hoursX100)}</td>
                      <td className="px-2 py-1.5">
                        <input
                          className={cn(FIELD, "min-w-16 text-right tabular-nums")}
                          value={d.ot}
                          inputMode="decimal"
                          placeholder="0"
                          disabled={locked}
                          aria-label={`${r.name} 초과근무 시간`}
                          onChange={(e) => setDrafts((p) => ({ ...p, [r.userId]: { ...d, ot: e.target.value } }))}
                          onBlur={() => saveOvertime(r)}
                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className={cn(FIELD, "min-w-32")}
                          value={d.reason}
                          placeholder="예: 커피머신 청소"
                          disabled={locked}
                          aria-label={`${r.name} 초과근무 사유`}
                          onChange={(e) => setDrafts((p) => ({ ...p, [r.userId]: { ...d, reason: e.target.value } }))}
                          onBlur={() => saveOvertime(r)}
                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                        {r.confirmedBy ? (
                          <span className="text-success">
                            {r.confirmedBy}
                            {isHq && r.logId ? (
                              <form action={confirm} className="inline">
                                <input type="hidden" name="id" value={r.logId} />
                                <input type="hidden" name="undo" value="1" />
                                <button type="submit" className="ml-1 text-muted-foreground underline-offset-2 hover:underline">
                                  취소
                                </button>
                              </form>
                            ) : null}
                          </span>
                        ) : isHq && r.logId ? (
                          <form action={confirm}>
                            <input type="hidden" name="id" value={r.logId} />
                            <button type="submit" className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted">
                              확인
                            </button>
                          </form>
                        ) : (
                          <span className="text-muted-foreground">{r.logId ? "미확인" : ""}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{formatHours(r.hoursX100 + r.overtimeX100)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
