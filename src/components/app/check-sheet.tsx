"use client";

import { Search } from "lucide-react";
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

  function quick(row: SheetRow, grade: Grade) {
    if (grade === "p") {
      setEditing({ ...row, grade: "p", penaltyRuleId: row.penaltyRuleId ?? rules[0]?.id ?? null });
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
    <div className="space-y-3">
      <div className="sticky top-14 z-20 -mx-4 space-y-2 border-b bg-background px-4 py-2 md:-mx-6 md:px-6">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 또는 좌석번호" className="pl-8" inputMode="search" />
          </div>
          <span className="text-sm tabular-nums text-muted-foreground">
            {done}/{rows.length}
          </span>
          {pending ? <span className="text-xs text-muted-foreground">저장 중…</span> : null}
          {queued > 0 ? (
            <button type="button" onClick={flushQueue} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              미전송 {queued}건 · 다시 시도
            </button>
          ) : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      {groups.map(([zone, list]) => (
        <section key={zone}>
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">{zone} 구역</h3>
          <ul className="divide-y rounded-lg border">
            {list.map((r) => (
              <li key={r.memberId} className="flex items-center gap-2 px-2 py-2">
                <button type="button" onClick={() => setEditing(r)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="w-8 shrink-0 text-center text-sm font-semibold tabular-nums">{r.seatNo ?? "-"}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {r.name}
                      {r.focusCare ? <span className="ml-1 text-[10px] text-violet-700">집중</span> : null}
                    </span>
                    {r.fieldNote ? <span className="block truncate text-xs text-muted-foreground">{r.fieldNote}</span> : null}
                    {r.grade === "p" ? (
                      <span className="block truncate text-xs text-red-600">
                        {rules.find((x) => x.id === r.penaltyRuleId)?.name ?? "벌점"} {r.points}점{r.isIssue ? " · 이슈" : ""}
                        {r.note ? ` · ${r.note}` : ""}
                      </span>
                    ) : r.note ? (
                      <span className="block truncate text-xs text-muted-foreground">{r.note}</span>
                    ) : null}
                  </span>
                </button>
                <div className="flex shrink-0 gap-1" role="group" aria-label={`${r.name} 등급`}>
                  {QUICK.map((qk) => (
                    <button
                      key={qk.grade}
                      type="button"
                      onClick={() => quick(r, qk.grade)}
                      aria-pressed={r.grade === qk.grade}
                      className={cn(
                        "h-9 min-w-9 rounded-md border px-2 text-xs font-semibold transition-colors",
                        r.grade === qk.grade ? cn(GRADE_STYLE[qk.grade], "border-transparent") : "bg-background text-muted-foreground",
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
        <div className="sticky bottom-16 z-20 pt-2 md:bottom-4">
          <Button size="lg" className="h-12 w-full text-base" onClick={complete} disabled={pending}>
            {completed ? "회차 다시 완료 처리" : `회차 완료 (미입력 ${rows.length - done}명은 a로 처리)`}
          </Button>
        </div>
      ) : null}

      <Sheet open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          {editing ? (
            <>
              <SheetHeader>
                <SheetTitle>
                  {editing.seatNo ?? "-"}번 · {editing.name}
                </SheetTitle>
                <SheetDescription>{editing.fieldNote ?? "특이사항 없음"}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-4">
                <div className="grid grid-cols-4 gap-2">
                  {QUICK.map((qk) => (
                    <button
                      key={qk.grade}
                      type="button"
                      onClick={() => setEditing({ ...editing, grade: qk.grade, penaltyRuleId: qk.grade === "p" ? (editing.penaltyRuleId ?? rules[0]?.id ?? null) : null })}
                      className={cn("h-11 rounded-md border text-sm font-semibold", editing.grade === qk.grade ? cn(GRADE_STYLE[qk.grade], "border-transparent") : "")}
                    >
                      {qk.label}
                    </button>
                  ))}
                </div>
                {editing.grade === "p" ? (
                  <div className="space-y-1">
                    <Label>벌점 규칙</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {rules.map((rule) => (
                        <button
                          key={rule.id}
                          type="button"
                          onClick={() => setEditing({ ...editing, penaltyRuleId: rule.id })}
                          className={cn("flex h-11 items-center justify-between rounded-md border px-3 text-sm", editing.penaltyRuleId === rule.id ? "border-red-500 bg-red-50 text-red-700" : "")}
                        >
                          <span>{rule.name}</span>
                          <span className="font-semibold">{rule.points}점</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {isAttendance ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="arrival">등원 시각</Label>
                      <Input id="arrival" type="time" value={editing.arrivalTime?.slice(0, 5) ?? ""} onChange={(e) => setEditing({ ...editing, arrivalTime: e.target.value || null })} />
                    </div>
                    <label className="flex items-end gap-2 pb-2 text-sm">
                      <input type="checkbox" className="size-4" checked={editing.called ?? false} onChange={(e) => setEditing({ ...editing, called: e.target.checked })} />
                      전화 확인(CALL)
                    </label>
                  </div>
                ) : null}
                <div className="space-y-1">
                  <Label htmlFor="note">메모</Label>
                  <Textarea id="note" rows={2} value={editing.note ?? ""} onChange={(e) => setEditing({ ...editing, note: e.target.value })} placeholder="예: 학원 일정으로 조퇴" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" checked={editing.isIssue} onChange={(e) => setEditing({ ...editing, isIssue: e.target.checked })} />
                  지점장에게 이슈로 보고
                </label>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setEditing(null)}>
                    취소
                  </Button>
                  <Button
                    className="flex-1"
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
          <DialogTitle>R{roundNo} 회차 완료</DialogTitle>
          <DialogDescription>결과 요약</DialogDescription>
          {summary ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">점검 인원</dt>
              <dd>{summary.total}명</dd>
              <dt className="text-muted-foreground">벌점</dt>
              <dd>
                {summary.penalties}건 · {summary.points}점
              </dd>
              <dt className="text-muted-foreground">이슈 보고</dt>
              <dd>{summary.issues}건</dd>
              <dt className="text-muted-foreground">부재</dt>
              <dd>{summary.absent}명</dd>
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
