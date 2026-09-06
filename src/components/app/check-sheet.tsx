"use client";

import { AlertTriangle, CheckCircle2, CloudOff, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { Grade } from "@/db/schema";
import { cn } from "@/lib/utils";
import type { CheckInput, PenaltyRule, SessionSummary, SheetRow } from "@/modules/rounding/repo";
import { GRADE_STYLE } from "./grade-chip";

type Props = {
  date: string;
  itemKey: string;
  roundNo: number;
  sessionId?: string | null;
  rows: SheetRow[];
  rules: PenaltyRule[];
  saveAction: (input: CheckInput) => Promise<{ ok?: boolean; error?: string }>;
  completeAction?: (sessionId: string) => Promise<{ summary?: SessionSummary; error?: string }>;
  completed?: boolean;
};

const QUICK: { grade: Grade; label: string }[] = [
  { grade: "a", label: "a" },
  { grade: "b", label: "b" },
  { grade: "p", label: "벌점" },
  { grade: "na", label: "부재" },
];

/** 편집 시트에서 선택된 등급의 테두리 색 */
const GRADE_RING: Record<Grade, string> = { a: "ring-emerald-500", b: "ring-lime-400", p: "ring-rose-500", na: "ring-neutral-400" };

const QUEUE_KEY = "byeolha.checkQueue";

type QueuedSave = { input: CheckInput; at: number };

function readQueue(): QueuedSave[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedSave[];
  } catch {
    return [];
  }
}
function writeQueue(q: QueuedSave[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* 저장소 사용 불가 시 무시 */
  }
}

/** 좌석번호 칩. 라운딩 목록과 편집 시트에서 같은 모양으로 쓴다 */
function SeatChip({ seatNo, className }: { seatNo: number | null; className?: string }) {
  return <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-accent-foreground", className)}>{seatNo ?? "-"}</span>;
}

export function CheckSheet({ date, itemKey, roundNo, sessionId, rows: initial, rules, saveAction, completeAction, completed }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [queued, setQueued] = useState(0);
  const flushing = useRef(false);

  // 네트워크 오류로 저장하지 못한 입력은 브라우저에 쌓아 두고 온라인이 되면 다시 보낸다
  async function flushQueue() {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let q = readQueue();
      const rest: QueuedSave[] = [];
      for (const item of q) {
        try {
          const res = await saveAction(item.input);
          if (res.error) continue; // 서버가 거부한 입력은 버린다 (검증 오류)
        } catch {
          rest.push(item);
        }
      }
      q = rest;
      writeQueue(q);
      setQueued(q.length);
    } finally {
      flushing.current = false;
    }
  }
  useEffect(() => {
    // 마운트 시 큐를 비우면서 미전송 수도 갱신된다
    flushQueue();
    const onOnline = () => flushQueue();
    window.addEventListener("online", onOnline);
    const id = setInterval(() => {
      if (readQueue().length) flushQueue();
    }, 10000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<SheetRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [pending, startTransition] = useTransition();
  const isAttendance = itemKey === "attendance";

  const visible = useMemo(() => {
    const t = q.trim();
    if (!t) return rows;
    return rows.filter((r) => r.name.includes(t) || String(r.seatNo ?? "") === t);
  }, [rows, q]);

  const groups = useMemo(() => {
    const map = new Map<string, SheetRow[]>();
    for (const r of visible) {
      const key = r.zone ?? "미배정";
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()];
  }, [visible]);

  const done = rows.filter((r) => r.grade).length;
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;
  const ruleName = (id: string | null) => rules.find((x) => x.id === id)?.name ?? "벌점";

  function apply(row: SheetRow, patch: Partial<SheetRow>) {
    const next = { ...row, ...patch };
    setRows((prev) => prev.map((r) => (r.memberId === row.memberId ? next : r)));
    setError(null);
    const rule = next.grade === "p" ? rules.find((x) => x.id === next.penaltyRuleId) : null;
    startTransition(async () => {
      const input: CheckInput = {
        memberId: row.memberId,
        date,
        itemKey,
        roundNo,
        sessionId: sessionId ?? null,
        grade: next.grade ?? "a",
        penaltyRuleId: next.grade === "p" ? (rule?.id ?? null) : null,
        note: next.note,
        isIssue: next.isIssue,
        arrivalTime: isAttendance ? next.arrivalTime : null,
        called: isAttendance ? next.called : null,
      };
      let res: { ok?: boolean; error?: string };
      try {
        res = await saveAction(input);
      } catch {
        // 오프라인·네트워크 오류: 큐에 넣고 화면은 유지
        const q = readQueue().filter((x) => !(x.input.memberId === input.memberId && x.input.itemKey === input.itemKey && x.input.roundNo === input.roundNo && x.input.date === input.date));
        q.push({ input, at: Date.now() });
        writeQueue(q);
        setQueued(q.length);
        if (next.grade === "p") setRows((prev) => prev.map((r) => (r.memberId === row.memberId ? { ...r, points: rule?.points ?? 0 } : r)));
        return;
      }
      if (res.error) {
        setError(res.error);
        setRows((prev) => prev.map((r) => (r.memberId === row.memberId ? row : r)));
      } else if (next.grade === "p") {
        setRows((prev) => prev.map((r) => (r.memberId === row.memberId ? { ...r, points: rule?.points ?? 0 } : r)));
      }
    });
  }

  /** 오늘 이미 졸음 벌점이 있으면 "연속 졸음" 규칙을 먼저 고른다 */
  function suggestedRule(row: SheetRow): string | null {
    if (row.penaltyRuleId) return row.penaltyRuleId;
    if (row.priorPenalties.some((n) => n.includes("졸음"))) {
      const consecutive = rules.find((r) => r.name.includes("연속"));
      if (consecutive) return consecutive.id;
    }
    return rules[0]?.id ?? null;
  }

  function quick(row: SheetRow, grade: Grade) {
    if (grade === "p") {
      setEditing({ ...row, grade: "p", penaltyRuleId: suggestedRule(row) });
      return;
    }
    apply(row, { grade, penaltyRuleId: null, points: 0 });
  }

  async function complete() {
    if (!completeAction || !sessionId) return;
    const res = await completeAction(sessionId);
    if (res.error) setError(res.error);
    else if (res.summary) setSummary(res.summary);
  }

  return (
    <div className="space-y-4">
      {/* 상단 고정 도구 막대: 검색 · 진행률 · 저장 상태 */}
      <div className="sticky top-14 z-20 -mx-4 border-b border-border/70 bg-background/90 px-4 pt-2.5 pb-0 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex items-center gap-2 pb-2.5">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 또는 좌석번호" className="h-10 rounded-full bg-card pl-9" inputMode="search" />
          </div>
          <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium text-muted-foreground">
            <span className="text-foreground">{done}</span>/{rows.length}
          </span>
          {pending ? <span className="text-xs text-muted-foreground">저장 중…</span> : null}
          {queued > 0 ? (
            <button type="button" onClick={flushQueue} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-600/20">
              <CloudOff className="size-3.5" /> 미전송 {queued}건 · 다시 시도
            </button>
          ) : null}
        </div>
        <div className="h-0.5 w-full bg-muted" aria-hidden>
          <div className={cn("h-full transition-[width]", pct === 100 ? "bg-emerald-500" : "bg-primary")} style={{ width: `${pct}%` }} />
        </div>
        {error ? (
          <p className="flex items-center gap-1.5 py-2 text-sm text-destructive">
            <AlertTriangle className="size-4" /> {error}
          </p>
        ) : null}
      </div>

      {groups.map(([zone, list]) => (
        <section key={zone} className="overflow-hidden rounded-xl bg-card shadow-(--shadow-card) ring-1 ring-border">
          <header className="flex items-center justify-between border-b border-border/70 bg-muted/40 px-4 py-1.5">
            <h3 className="section-title">{zone} 구역</h3>
            <span className="text-xs text-muted-foreground">
              {list.filter((r) => r.grade).length}/{list.length}
            </span>
          </header>
          <ul className="divide-y divide-border/70">
            {list.map((r) => (
              <li key={r.memberId} className={cn("flex items-center gap-3 px-3 py-2.5 transition-colors", r.grade === "p" && "bg-rose-50/40")}>
                <button type="button" onClick={() => setEditing(r)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <SeatChip seatNo={r.seatNo} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-medium">{r.name}</span>
                      {r.focusCare ? <span className="rounded-full bg-violet-50 px-1.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-600/15">집중</span> : null}
                    </span>
                    {r.fieldNote ? <span className="block truncate text-xs text-muted-foreground">{r.fieldNote}</span> : null}
                    {r.priorPenalties.length ? (
                      <span className="mt-0.5 inline-flex max-w-full items-center rounded-full bg-amber-50 px-1.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-600/15">
                        <span className="truncate">오늘 이전 벌점: {r.priorPenalties.join(", ")}</span>
                      </span>
                    ) : null}
                    {r.grade === "p" ? (
                      <span className="block truncate text-xs font-medium text-rose-600">
                        {ruleName(r.penaltyRuleId)} {r.points}점{r.isIssue ? " · 이슈" : ""}
                        {r.note ? ` · ${r.note}` : ""}
                      </span>
                    ) : r.note ? (
                      <span className="block truncate text-xs text-muted-foreground">{r.note}</span>
                    ) : null}
                  </span>
                </button>
                <div className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5" role="group" aria-label={`${r.name} 등급`}>
                  {QUICK.map((qk) => (
                    <button
                      key={qk.grade}
                      type="button"
                      onClick={() => quick(r, qk.grade)}
                      aria-pressed={r.grade === qk.grade}
                      className={cn(
                        "h-9 min-w-10 rounded-md px-2 text-xs font-semibold transition-all",
                        r.grade === qk.grade ? cn(GRADE_STYLE[qk.grade], "shadow-(--shadow-card)") : "text-muted-foreground hover:bg-card hover:text-foreground",
                      )}
                    >
                      {qk.grade === "p" && r.grade === "p" ? r.points : qk.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {completeAction && sessionId ? (
        <div className="sticky bottom-16 z-20 pt-1 md:bottom-4">
          <div className="rounded-xl bg-card/95 p-2 shadow-(--shadow-float) ring-1 ring-border backdrop-blur">
            <Button size="lg" className="h-12 w-full text-[15px]" onClick={complete} disabled={pending}>
              <CheckCircle2 /> {completed ? "회차 다시 완료 처리" : `회차 완료 (미입력 ${rows.length - done}명은 a로 처리)`}
            </Button>
          </div>
        </div>
      ) : null}

      <Sheet open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl">
          {editing ? (
            <>
              <SheetHeader className="flex-row items-center gap-3">
                <SeatChip seatNo={editing.seatNo} className="size-11 rounded-xl text-base" />
                <div className="min-w-0">
                  <SheetTitle className="text-lg">{editing.name}</SheetTitle>
                  <SheetDescription>{editing.fieldNote ?? "특이사항 없음"}</SheetDescription>
                </div>
              </SheetHeader>
              <div className="space-y-5 px-4 pb-5">
                {editing.priorPenalties.length ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-amber-600/15">오늘 이전 벌점: {editing.priorPenalties.join(", ")}</p>
                ) : null}
                <div className="grid grid-cols-4 gap-2">
                  {QUICK.map((qk) => (
                    <button
                      key={qk.grade}
                      type="button"
                      onClick={() => setEditing({ ...editing, grade: qk.grade, penaltyRuleId: qk.grade === "p" ? suggestedRule(editing) : null })}
                      className={cn(
                        "h-12 rounded-xl text-sm font-semibold transition-all",
                        editing.grade === qk.grade ? cn(GRADE_STYLE[qk.grade], GRADE_RING[qk.grade], "shadow-(--shadow-float) ring-2 ring-offset-2 ring-offset-background") : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {qk.label}
                    </button>
                  ))}
                </div>
                {editing.grade === "p" ? (
                  <div className="space-y-1.5">
                    <Label>벌점 규칙</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {rules.map((rule) => {
                        const on = editing.penaltyRuleId === rule.id;
                        return (
                          <button
                            key={rule.id}
                            type="button"
                            onClick={() => setEditing({ ...editing, penaltyRuleId: rule.id })}
                            className={cn(
                              "flex h-12 items-center justify-between rounded-xl px-3 text-sm transition-all",
                              on ? "bg-rose-50 font-medium text-rose-700 ring-2 ring-rose-500" : "bg-card ring-1 ring-border hover:bg-accent/40",
                            )}
                          >
                            <span>{rule.name}</span>
                            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", on ? "bg-rose-500 text-white" : "bg-muted text-muted-foreground")}>{rule.points}점</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {isAttendance ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="arrival">등원 시각</Label>
                      <Input id="arrival" type="time" className="h-11" value={editing.arrivalTime?.slice(0, 5) ?? ""} onChange={(e) => setEditing({ ...editing, arrivalTime: e.target.value || null })} />
                    </div>
                    <label className="flex items-center gap-2 self-end rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
                      <input type="checkbox" className="size-4 accent-primary" checked={editing.called ?? false} onChange={(e) => setEditing({ ...editing, called: e.target.checked })} />
                      전화 확인(CALL)
                    </label>
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="note">메모</Label>
                  <Textarea id="note" rows={2} value={editing.note ?? ""} onChange={(e) => setEditing({ ...editing, note: e.target.value })} placeholder="예: 학원 일정으로 조퇴" />
                </div>
                <label className="flex items-center gap-2.5 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={editing.isIssue} onChange={(e) => setEditing({ ...editing, isIssue: e.target.checked })} />
                  <span className="flex-1">지점장에게 이슈로 보고</span>
                  <AlertTriangle className="size-4 text-muted-foreground" aria-hidden />
                </label>
                <div className="flex gap-2">
                  <Button variant="outline" size="lg" className="h-11 flex-1" onClick={() => setEditing(null)}>
                    취소
                  </Button>
                  <Button
                    size="lg"
                    className="h-11 flex-1"
                    onClick={() => {
                      const row = rows.find((r) => r.memberId === editing.memberId)!;
                      apply(row, { grade: editing.grade ?? "a", penaltyRuleId: editing.penaltyRuleId, note: editing.note, isIssue: editing.isIssue, arrivalTime: editing.arrivalTime, called: editing.called });
                      setEditing(null);
                    }}
                  >
                    저장
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={Boolean(summary)} onOpenChange={(o) => !o && router.push("/rounding")}>
        <DialogContent>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-600" /> R{roundNo} 회차 완료
          </DialogTitle>
          <DialogDescription>결과 요약</DialogDescription>
          {summary ? (
            <dl className="grid grid-cols-2 gap-2">
              {[
                ["점검 인원", `${summary.total}명`, ""],
                ["벌점", `${summary.penalties}건 · ${summary.points}점`, summary.points > 0 ? "text-rose-600" : ""],
                ["이슈 보고", `${summary.issues}건`, summary.issues > 0 ? "text-amber-700" : ""],
                ["부재", `${summary.absent}명`, ""],
              ].map(([k, v, cls]) => (
                <div key={k} className="rounded-xl bg-muted/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className={cn("mt-0.5 text-lg font-semibold", cls)}>{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <DialogFooter>
            <Button onClick={() => router.push("/rounding")}>조교 홈으로</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
