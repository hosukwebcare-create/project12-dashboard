"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, CloudOff, Eraser, NotebookPen, Search, Undo2 } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { PrintButton } from "@/components/app/print-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { Grade } from "@/db/schema";
import { pointsFor, sumPoints } from "@/lib/rules/penalty";
import { ATTENDANCE_KEY, autoAttendanceCell, canFillRest, cellKey, deriveAttendance, escalateSleepy, nextRoundNo, ROUND_KEY, type DayCell, type DayColumn } from "@/lib/rules/rounding";
import { cn } from "@/lib/utils";
import type { CellPatch, CheckInput, DayMember, SessionSummary } from "@/modules/rounding/repo";

type Rule = { id: string; name: string; points: number };
type CellAddr = { memberId: string; date: string; itemKey: string; roundNo: number };
/** 적을 값. 메모·이슈를 빼고 보내면(펜) 서버가 저장된 메모·이슈를 그대로 둔다 — 다른 기기가 적은 메모를 지우지 않게 */
type Draft = { grade: Grade; penaltyRuleId: string | null; note?: string | null; isIssue?: boolean };

type Props = {
  date: string;
  isToday: boolean;
  branchName: string;
  columns: DayColumn[];
  members: DayMember[];
  cells: Record<string, DayCell>;
  rules: Rule[];
  /** 완료한 회차 번호 */
  completedRounds: number[];
  canEdit: boolean;
  /** 적을 수 없을 때 그 까닭(멘토, 앞으로의 날짜) */
  readOnlyReason?: string | null;
  /** 예전 회차 주소(/rounding/회차id)로 들어오면 그 회차만 크게 보여 준다 */
  focusRound?: number | null;
  saveAction: (input: CheckInput) => Promise<{ patch?: CellPatch; error?: string }>;
  clearAction: (input: CellAddr) => Promise<{ patch?: CellPatch; error?: string }>;
  copyPrevAction: (input: { date: string; roundNo: number }) => Promise<{ patch?: CellPatch; error?: string }>;
  completeAction: (input: { date: string; roundNo: number }) => Promise<{ patch?: CellPatch; summary?: SessionSummary; error?: string }>;
  fillRestAction: (input: { date: string; itemKey: string }) => Promise<{ patch?: CellPatch; error?: string }>;
  /** 표 새로 읽기. 다른 기기(태블릿·PC)가 적은 것을 따라간다 */
  refreshAction: (input: { date: string }) => Promise<{ cells?: Record<string, DayCell>; completedRounds?: number[]; error?: string }>;
};

/** 다른 기기가 적은 것을 따라가는 간격 */
const REFRESH_MS = 30_000;
/** 가로 A4 로 인쇄한다. 이 표가 있는 화면에서만(다른 화면의 인쇄는 세로·가로를 고를 수 있게) */
const PRINT_PAGE = "@media print { @page { size: A4 landscape; margin: 8mm; } }";

const sameCellValue = (a: DayCell, b: DayCell) => a.grade === b.grade && a.points === b.points && a.penaltyRuleId === b.penaltyRuleId && a.note === b.note && a.isIssue === b.isIssue && a.auto === b.auto;

/** 새로 읽은 칸을 합친다. 값이 같은 칸은 원래 객체를 그대로 두어 그 줄을 다시 그리지 않고, 하나도 안 바뀌었으면 원래 표를 돌려준다 */
function mergeCells(prev: Record<string, DayCell>, next: Record<string, DayCell>): Record<string, DayCell> {
  let changed = Object.keys(prev).length !== Object.keys(next).length;
  const out: Record<string, DayCell> = {};
  for (const [k, v] of Object.entries(next)) {
    const p = prev[k];
    if (p && sameCellValue(p, v)) out[k] = p;
    else {
      out[k] = v;
      changed = true;
    }
  }
  return changed ? out : prev;
}

/**
 * 펜. 고른 펜으로 칸을 누르면 그 값이 적힌다. 태블릿에서 글을 쓰지 않고 누르기만 하려는 것 —
 * 벌점도 규칙마다 펜이 따로 있어서 사유를 고르는 창이 뜨지 않는다. 메모는 '메모·자세히' 펜(PC)으로 적는다.
 */
type Pen = { kind: "a" } | { kind: "b" } | { kind: "na" } | { kind: "rule"; ruleId: string } | { kind: "erase" } | { kind: "note" };

const colId = (c: { itemKey: string; roundNo: number }) => `${c.itemKey}|${c.roundNo}`;

/** 칸 색. a 는 대부분이라 글자만, 눈에 띄어야 하는 b·벌점·부재만 바탕색을 쓴다 (흰 글씨 없이 짙은 글자로 대비를 맞춘다) */
const CELL_STYLE: Record<Grade, string> = {
  a: "text-muted-foreground",
  b: "bg-lime-100 text-lime-900",
  p: "bg-rose-100 text-rose-800",
  na: "bg-muted text-muted-foreground text-[11px]",
};

const QUEUE_KEY = "byeolha.daySheetQueue";
/** 예전 회차 화면이 쓰던 미전송 저장소. 배포 전에 쌓인 것을 한 번 옮겨 보낸다 */
const LEGACY_QUEUE_KEY = "byeolha.checkQueue";
type QueuedOp = { op: "save"; input: CheckInput } | { op: "clear"; input: CellAddr };

function readQueue(): QueuedOp[] {
  try {
    const list = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedOp[];
    // 예전 형식 { input, at } 은 저장이다
    const legacy = JSON.parse(localStorage.getItem(LEGACY_QUEUE_KEY) ?? "[]") as { input: CheckInput }[];
    if (legacy.length) {
      const merged = [...legacy.map((x) => ({ op: "save" as const, input: x.input })), ...list];
      localStorage.setItem(QUEUE_KEY, JSON.stringify(merged));
      localStorage.removeItem(LEGACY_QUEUE_KEY);
      return merged;
    }
    return list;
  } catch {
    return [];
  }
}
function writeQueue(q: QueuedOp[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* 저장소를 쓸 수 없으면 무시 */
  }
}
const sameCell = (a: CellAddr, b: CellAddr) => a.memberId === b.memberId && a.date === b.date && a.itemKey === b.itemKey && a.roundNo === b.roundNo;

function cellText(cell: DayCell | undefined): string {
  if (!cell) return "";
  if (cell.grade === "p") return String(cell.points);
  if (cell.grade === "na") return "부재";
  return cell.grade;
}

type RowProps = {
  m: DayMember;
  rowIndex: number;
  cols: DayColumn[];
  rowCells: (DayCell | undefined)[];
  /** 커서가 이 줄에 있으면 그 열 번호, 아니면 -1 */
  cursorCol: number;
  nowRound: number | null;
  canEdit: boolean;
  big: boolean;
  /** 이 줄 앞에 구역 머리글을 붙일 때 그 이름 */
  zoneHeader: string | null;
  valueLabel: (cell: DayCell | undefined) => string;
  onCell: (memberId: string, colIndex: number) => void;
};

/**
 * 학생 한 줄. 칸 하나를 누를 때 표 전체(학생 80명 × 16열)를 다시 그리지 않도록 줄마다 따로 기억한다 —
 * 값이 바뀐 줄(과 커서가 오간 줄)만 다시 그린다. 값 비교는 칸 객체가 같은지로 한다(안 바뀐 칸은 같은 객체를 유지한다).
 */
const DayRow = memo(
  function DayRow({ m, cols, rowCells, cursorCol, nowRound, canEdit, big, zoneHeader, valueLabel, onCell }: RowProps) {
    const pts = sumPoints(rowCells.filter((c): c is DayCell => Boolean(c)));
    return (
      <Fragment>
        {zoneHeader ? (
          <tr>
            <th colSpan={cols.length + 3} scope="rowgroup" className="border-b border-border bg-muted/60 px-2 py-1 text-left text-xs font-semibold text-muted-foreground">
              <span className="sticky left-2">{zoneHeader} 구역</span>
            </th>
          </tr>
        ) : null}
        <tr>
          <td className="sticky left-0 z-10 w-11 border-r border-b border-border bg-card text-center text-sm font-medium text-muted-foreground tabular-nums">{m.seatNo ?? "-"}</td>
          <th scope="row" className="sticky left-11 z-10 w-24 max-w-24 border-r border-b border-border bg-card px-2 text-left font-medium">
            <span className="flex items-center gap-1">
              <span className="truncate">{m.name}</span>
              {m.focusCare ? <span className="shrink-0 rounded-sm bg-violet-50 px-1 text-[10px] font-medium text-violet-800">집중</span> : null}
            </span>
            {/* 특이사항은 도는 사람이 봐야 한다(예: 매주 화 학원). 태블릿에는 마우스를 올려 보는 풍선말이 없다 */}
            {m.fieldNote ? <span className="block truncate text-[10px] leading-tight font-normal text-muted-foreground">{m.fieldNote}</span> : null}
          </th>
          {cols.map((c, i) => {
            const cell = rowCells[i];
            const now = c.kind === "round" && c.roundNo === nowRound;
            const isCursor = cursorCol === i;
            const cls = cn(
              "relative w-full border-r border-b border-border tabular-nums",
              big ? "h-14 text-base font-semibold" : "h-11 text-[13px] font-semibold",
              cell ? CELL_STYLE[cell.grade] : now ? "bg-accent/40" : "",
              isCursor && "ring-2 ring-primary ring-inset",
            );
            const marks = (
              <>
                {cell?.note && !cell.auto ? <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary print:hidden" aria-hidden /> : null}
                {cell?.isIssue ? <span className="absolute top-1 left-1 size-1.5 rounded-full bg-rose-600 print:hidden" aria-hidden /> : null}
              </>
            );
            if (!canEdit || c.kind === "auto") {
              return (
                <td key={colId(c)} className={cls} data-cursor={isCursor ? "true" : undefined} onClick={() => onCell(m.memberId, i)} title={cell?.note && !cell.auto ? cell.note : undefined}>
                  <span className="cell-value flex h-full items-center justify-center">{cellText(cell)}</span>
                  <span className="sr-only">{`${m.name} ${c.label} ${valueLabel(cell)}${cell?.note && !cell.auto ? ` · 메모: ${cell.note}` : ""}`}</span>
                  {marks}
                </td>
              );
            }
            return (
              <td key={colId(c)} className="p-0">
                <button
                  type="button"
                  className={cn(cls, "flex items-center justify-center hover:brightness-95 active:brightness-90")}
                  data-cursor={isCursor ? "true" : undefined}
                  onClick={() => onCell(m.memberId, i)}
                  aria-label={`${m.name} ${c.label} ${valueLabel(cell)}`}
                  title={cell?.note ? cell.note : undefined}
                >
                  <span className="cell-value">{cellText(cell)}</span>
                  {marks}
                </button>
              </td>
            );
          })}
          <td className={cn("border-b border-border px-1 text-center text-sm font-semibold tabular-nums", pts > 0 ? "text-rose-700" : "text-muted-foreground")}>
            <span className="cell-value">{pts || ""}</span>
          </td>
        </tr>
      </Fragment>
    );
  },
  (a, b) =>
    a.m === b.m &&
    a.rowIndex === b.rowIndex &&
    a.cols === b.cols &&
    a.cursorCol === b.cursorCol &&
    a.nowRound === b.nowRound &&
    a.canEdit === b.canEdit &&
    a.big === b.big &&
    a.zoneHeader === b.zoneHeader &&
    a.valueLabel === b.valueLabel &&
    a.onCell === b.onCell &&
    a.rowCells.length === b.rowCells.length &&
    a.rowCells.every((c, i) => c === b.rowCells[i]),
);

export function DaySheet({ date, isToday, branchName, columns, members, cells: initialCells, rules, completedRounds, canEdit, readOnlyReason, focusRound = null, saveAction, clearAction, copyPrevAction, completeAction, fillRestAction, refreshAction }: Props) {
  const [cells, setCells] = useState(initialCells);
  const [pen, setPen] = useState<Pen>({ kind: "a" });
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [queued, setQueued] = useState(0);
  const flushing = useRef(false);
  /** 보내는 중인 저장 수와, 저장을 시작할 때마다 오르는 번호. 새로 읽은 표가 그사이 적은 것을 덮지 않게 한다 */
  const inflight = useRef(0);
  const writeSeq = useRef(0);
  /** gradeOnly: 펜으로 등급만 바꾼 것. 되돌릴 때도 등급만 되돌려 그사이 다른 기기가 적은 메모를 지우지 않는다 */
  const [undo, setUndo] = useState<{ addr: CellAddr; prev: DayCell | null; gradeOnly: boolean }[]>([]);
  const [menuCol, setMenuCol] = useState<DayColumn | null>(null);
  const [ask, setAsk] = useState<{ kind: "copy" | "complete" | "fill"; col: DayColumn } | null>(null);
  const [detail, setDetail] = useState<{ member: DayMember; col: DayColumn; draft: { grade: Grade | null; penaltyRuleId: string | null; note: string; isIssue: boolean } } | null>(null);
  const [printBlank, setPrintBlank] = useState(false);
  const [completed, setCompleted] = useState(() => new Set(completedRounds));
  const [focus, setFocus] = useState<string | null>(() => (focusRound ? colId({ itemKey: ROUND_KEY, roundNo: focusRound }) : null));
  const [cursor, setCursor] = useState<{ row: number; col: number } | null>(null);

  const ruleById = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const roundCols = useMemo(() => columns.filter((c) => c.kind === "round"), [columns]);
  const hasAttendance = columns.some((c) => c.kind === "auto");
  const nowRound = isToday ? nextRoundNo([...completed], roundCols.length) : null;

  const rows = useMemo(() => {
    const t = q.trim();
    if (!t) return members;
    return members.filter((m) => m.name.includes(t) || String(m.seatNo ?? "") === t);
  }, [members, q]);
  const focused = focus ? (columns.find((c) => colId(c) === focus) ?? null) : null;
  const shownCols = useMemo(() => (focused ? columns.filter((c) => c.kind === "auto" || colId(c) === focus) : columns), [columns, focused, focus]);

  const at = (m: string, c: { itemKey: string; roundNo: number }) => cells[cellKey(m, c.itemKey, c.roundNo)];
  const filledIn = (c: DayColumn) => members.filter((m) => at(m.memberId, c)).length;

  function applyPatch(patch: CellPatch | undefined) {
    if (!patch || !Object.keys(patch).length) return;
    setCells((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        if (v) next[k] = v;
        else delete next[k];
      }
      return next;
    });
  }

  /** 화면 먼저: 라운딩 칸이 바뀌면 출석을 서버와 같은 규칙으로 미리 맞춘다. 사람이 적은 출석은 그대로 */
  function localAttendance(prev: Record<string, DayCell>, memberId: string): Record<string, DayCell> {
    if (!hasAttendance) return prev;
    const k = cellKey(memberId, ATTENDANCE_KEY, 0);
    const att = prev[k];
    if (att && !att.auto) return prev;
    const derived = deriveAttendance(roundCols.map((c) => prev[cellKey(memberId, c.itemKey, c.roundNo)]?.grade).filter((g): g is Grade => Boolean(g)));
    if ((att?.grade ?? null) === derived) return prev;
    const next = { ...prev };
    if (derived) next[k] = autoAttendanceCell(derived);
    else delete next[k];
    return next;
  }

  function setLocal(addr: CellAddr, value: DayCell | null) {
    setCells((prev) => {
      const next = { ...prev };
      const k = cellKey(addr.memberId, addr.itemKey, addr.roundNo);
      if (value) next[k] = value;
      else delete next[k];
      return addr.itemKey === ROUND_KEY ? localAttendance(next, addr.memberId) : next;
    });
  }

  function enqueue(op: QueuedOp) {
    const q2 = readQueue().filter((x) => !sameCell(x.input, op.input));
    q2.push(op);
    writeQueue(q2);
    setQueued(q2.length);
  }

  // 와이파이가 끊기는 자리에서도 적은 것은 브라우저에 쌓아 두었다가 연결되면 다시 보낸다.
  // 다른 날짜로 쌓인 것도 보내지만, 화면(이 날짜의 표)에는 이 날짜 것만 반영한다 — 칸 주소에 날짜가 없다.
  async function flushQueue() {
    if (flushing.current) return;
    flushing.current = true;
    writeSeq.current += 1;
    try {
      let list = readQueue();
      const rest: QueuedOp[] = [];
      const merged: CellPatch = {};
      for (const item of list) {
        try {
          const res = item.op === "save" ? await saveAction(item.input) : await clearAction(item.input);
          if (res.error) continue; // 서버가 거부한 입력은 버린다
          if (item.input.date === date && res.patch) Object.assign(merged, res.patch);
        } catch {
          rest.push(item);
        }
      }
      list = rest;
      writeQueue(list);
      setQueued(list.length);
      applyPatch(merged);
    } finally {
      flushing.current = false;
    }
  }
  useEffect(() => {
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

  // 다른 기기가 적은 것을 따라간다. 이 화면에서 보내는 중인 것이 있으면 이번 차례는 건너뛴다
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      if (inflight.current > 0 || flushing.current || readQueue().length) return;
      const seq = writeSeq.current;
      let res: Awaited<ReturnType<typeof refreshAction>>;
      try {
        res = await refreshAction({ date });
      } catch {
        return;
      }
      if (stopped || res.error || !res.cells) return;
      // 읽는 사이에 이 화면에서 적은 것이 있으면 읽은 것이 더 오래됐을 수 있어 버린다
      if (seq !== writeSeq.current || inflight.current > 0) return;
      const fresh = res.cells;
      const done = res.completedRounds ?? [];
      setCells((prev) => mergeCells(prev, fresh));
      setCompleted((prev) => (prev.size === done.length && done.every((n) => prev.has(n)) ? prev : new Set(done)));
    };
    const id = setInterval(tick, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [date, refreshAction]);

  // 오늘 돌 회차를 화면 안으로
  const nowRef = useRef<HTMLTableCellElement | null>(null);
  useEffect(() => {
    nowRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, []);

  // '이 열만 크게 보기' 중에 인쇄해도 표 전체가 나오게, 인쇄하는 동안만 하루 전체로 돌린다
  const focusRef = useRef<string | null>(focus);
  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);
  useEffect(() => {
    let saved: string | null = null;
    const before = () => {
      if (!focusRef.current) return;
      saved = focusRef.current;
      flushSync(() => setFocus(null));
    };
    const after = () => {
      if (saved) setFocus(saved);
      saved = null;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  /**
   * 칸 하나를 적거나(next) 비운다(null). 화면을 먼저 바꾸고 서버에 보낸다.
   * 통신이 끊기면 쌓아 두고, 서버가 거절하면 화면과 되돌리기 목록을 원래대로 돌린다.
   */
  function commit(member: DayMember, col: DayColumn, next: Draft | null, recordUndo = true) {
    const addr: CellAddr = { memberId: member.memberId, date, itemKey: col.itemKey, roundNo: col.roundNo };
    const prev = at(member.memberId, col) ?? null;
    if (!next && !prev) return;
    // 메모·이슈를 보내지 않으면 서버가 저장된 값을 둔다. 화면도 지금 값 그대로 보여 준다
    const note = next?.note === undefined ? (prev?.note ?? null) : next.note;
    const isIssue = next?.isIssue === undefined ? (prev?.isIssue ?? false) : next.isIssue;
    if (next && prev && prev.grade === next.grade && prev.penaltyRuleId === next.penaltyRuleId && (prev.note ?? null) === note && prev.isIssue === isIssue) return;
    setLocal(addr, next ? { grade: next.grade, penaltyRuleId: next.penaltyRuleId, note, isIssue, points: pointsFor(next.grade, ruleById.get(next.penaltyRuleId ?? "")?.points), auto: false } : null);
    const entry = { addr, prev, gradeOnly: Boolean(next) && next?.note === undefined && next?.isIssue === undefined };
    if (recordUndo) setUndo((u) => [...u.slice(-19), entry]);
    setError(null);
    const op: QueuedOp = next
      ? { op: "save", input: { ...addr, grade: next.grade, penaltyRuleId: next.penaltyRuleId, ...(next.note !== undefined ? { note: next.note } : {}), ...(next.isIssue !== undefined ? { isIssue: next.isIssue } : {}) } }
      : { op: "clear", input: addr };
    writeSeq.current += 1;
    inflight.current += 1;
    startTransition(async () => {
      try {
        let res: { patch?: CellPatch; error?: string };
        try {
          res = op.op === "save" ? await saveAction(op.input) : await clearAction(op.input);
        } catch {
          enqueue(op);
          return;
        }
        if (res.error) {
          setError(`${member.name} ${col.label}: ${res.error}`);
          setLocal(addr, prev);
          if (recordUndo) setUndo((u) => u.filter((x) => x !== entry));
        } else applyPatch(res.patch);
      } finally {
        inflight.current -= 1;
      }
    });
  }

  function undoLast() {
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    const member = members.find((m) => m.memberId === last.addr.memberId);
    const col = columns.find((c) => c.itemKey === last.addr.itemKey && c.roundNo === last.addr.roundNo);
    if (!member || !col) return;
    const p = last.prev;
    commit(member, col, p ? (last.gradeOnly ? { grade: p.grade, penaltyRuleId: p.penaltyRuleId } : { grade: p.grade, penaltyRuleId: p.penaltyRuleId, note: p.note, isIssue: p.isIssue }) : null, false);
  }

  /** 같은 날 이 칸보다 앞 회차에 받은 벌점 규칙들 (연속 졸음 판단용) */
  function earlierPenaltyRules(member: DayMember, col: DayColumn): (string | null)[] {
    if (col.kind !== "round") return [];
    return roundCols
      .filter((c) => c.roundNo < col.roundNo)
      .map((c) => at(member.memberId, c))
      .filter((c): c is DayCell => c?.grade === "p")
      .map((c) => c.penaltyRuleId);
  }

  function openDetail(member: DayMember, col: DayColumn) {
    const c = at(member.memberId, col);
    setDetail({ member, col, draft: { grade: c?.grade ?? null, penaltyRuleId: c?.penaltyRuleId ?? null, note: c?.note ?? "", isIssue: c?.isIssue ?? false } });
  }

  /** 펜은 등급만 바꾼다. 메모·이슈 표시는 서버에 있는 그대로 둔다(PC 에서 적은 메모를 태블릿이 지우지 않게) */
  function withPen(member: DayMember, col: DayColumn, p: Pen) {
    switch (p.kind) {
      case "note":
        openDetail(member, col);
        return;
      case "erase":
        commit(member, col, null);
        return;
      case "rule": {
        // 같은 날 앞 회차에 졸음이 있으면 연속 졸음으로 올린다(예전 벌점 창이 먼저 골라 주던 대로)
        const ruleId = escalateSleepy(rules, p.ruleId, earlierPenaltyRules(member, col));
        if (ruleId !== p.ruleId) setNotice(`${member.name}: 앞 회차에 졸음이 있어 ${ruleById.get(ruleId)?.name ?? "연속 졸음"}으로 적었습니다`);
        commit(member, col, { grade: "p", penaltyRuleId: ruleId });
        return;
      }
      default:
        commit(member, col, { grade: p.kind, penaltyRuleId: null });
    }
  }

  const valueLabel = useCallback((c: DayCell | undefined) => (!c ? "빈 칸" : c.grade === "p" ? `${ruleById.get(c.penaltyRuleId ?? "")?.name ?? "벌점"} ${c.points}점` : c.grade === "na" ? "부재" : c.grade), [ruleById]);

  function handleCell(memberId: string, colIndex: number) {
    const rowIndex = rows.findIndex((m) => m.memberId === memberId);
    const member = rows[rowIndex];
    const col = shownCols[colIndex];
    if (!member || !col) return;
    setCursor({ row: rowIndex, col: colIndex });
    if (col.kind === "auto") {
      setNotice("출석은 라운딩에서 저절로 채워집니다. 따로 적지 않아도 됩니다.");
      return;
    }
    if (!canEdit) {
      // 읽기 전용이어도 메모는 읽을 수 있어야 한다(멘토가 상담 전에 본다)
      const c = at(memberId, col);
      setNotice(`${member.name} ${col.label} · ${valueLabel(c)}${c?.note ? ` — ${c.note}` : ""}`);
      return;
    }
    withPen(member, col, pen);
  }
  // 줄에는 늘 같은 함수를 넘기고(그래야 줄을 다시 그리지 않는다), 실제 처리는 최신 상태를 보는 함수가 한다
  const cellHandler = useRef(handleCell);
  useEffect(() => {
    cellHandler.current = handleCell;
  });
  const onCell = useCallback((memberId: string, colIndex: number) => cellHandler.current(memberId, colIndex), []);

  /** 자세히 창에서 벌점을 고를 때: 오늘 앞 회차에 졸음이 있으면 '연속' 규칙을 먼저 고른다(바꿀 수 있다) */
  function suggestRule(member: DayMember, col: DayColumn): string | null {
    const first = rules[0]?.id ?? null;
    const sleepy = rules.find((r) => r.name.includes("졸음") && !r.name.includes("연속"))?.id;
    if (!sleepy) return first;
    const up = escalateSleepy(rules, sleepy, earlierPenaltyRules(member, col));
    return up !== sleepy ? up : first;
  }

  async function runBulk(kind: "copy" | "complete" | "fill", col: DayColumn) {
    setAsk(null);
    setMenuCol(null);
    setError(null);
    writeSeq.current += 1;
    inflight.current += 1;
    try {
      if (kind === "fill") {
        const res = await fillRestAction({ date, itemKey: col.itemKey });
        if (res.error) return setError(res.error);
        applyPatch(res.patch);
        setNotice(`${col.label}: 빈 칸 ${Object.keys(res.patch ?? {}).length}칸을 a로 채웠습니다`);
        return;
      }
      if (kind === "copy") {
        const res = await copyPrevAction({ date, roundNo: col.roundNo });
        if (res.error) return setError(res.error);
        applyPatch(res.patch);
        const n = members.filter((m) => res.patch?.[cellKey(m.memberId, ROUND_KEY, col.roundNo)]).length;
        setNotice(`R${col.roundNo - 1} 값을 R${col.roundNo}에 ${n}칸 가져왔습니다. 달라진 학생만 고치세요.`);
        return;
      }
      const res = await completeAction({ date, roundNo: col.roundNo });
      if (res.error) return setError(res.error);
      applyPatch(res.patch);
      setCompleted((prev) => new Set(prev).add(col.roundNo));
      const s = res.summary;
      setNotice(s ? `R${col.roundNo} 완료 · ${s.total}명 · 벌점 ${s.penalties}건 ${s.points}점 · 이슈 ${s.issues}건 · 부재 ${s.absent}명` : `R${col.roundNo} 완료`);
    } catch {
      setError("연결이 끊겨 처리하지 못했습니다. 연결을 확인한 뒤 다시 눌러 주세요.");
    } finally {
      inflight.current -= 1;
    }
  }

  /**
   * PC: 시트처럼 화살표로 옮겨 다니며 글쇠 하나로 적는다. 한글 입력 상태에서도 되도록 글쇠 위치(code)를 본다.
   * 표 안에 초점이 있을 때(또는 아무것도 누르지 않았을 때)만 받는다 — 펜·버튼 위의 Enter·Backspace 를 가로채지 않고, Tab 은 건드리지 않는다.
   * 처음 화살표를 누르면 오늘 돌 회차의 맨 위 칸에 커서가 생긴다(칸을 눌러 펜 값을 적지 않아도 된다).
   */
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (detail || ask || menuCol) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const inGrid = Boolean(el?.closest?.("[data-day-grid]"));
      const idle = !el || el === document.body;
      if (!inGrid && !idle) return;
      if (!rows.length || !shownCols.length) return;
      const nowIndex = shownCols.findIndex((c) => c.kind === "round" && c.roundNo === nowRound);
      const startCol = nowIndex >= 0 ? nowIndex : Math.max(0, shownCols.findIndex((c) => c.kind !== "auto"));
      const cur = cursor ?? { row: 0, col: startCol };
      const arrows: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      const step = arrows[e.code];
      if (step) {
        e.preventDefault();
        setCursor(cursor ? { row: Math.max(0, Math.min(rows.length - 1, cur.row + step[0])), col: Math.max(0, Math.min(shownCols.length - 1, cur.col + step[1])) } : cur);
        return;
      }
      if (!cursor) return;
      const row = rows[cur.row];
      const col = shownCols[cur.col];
      if (!row || !col || col.kind === "auto") return;
      let p: Pen | null = null;
      if (e.code === "KeyA") p = { kind: "a" };
      else if (e.code === "KeyB") p = { kind: "b" };
      else if (e.code === "Digit0" || e.code === "Numpad0" || e.code === "KeyN") p = { kind: "na" };
      else if (e.code === "Backspace" || e.code === "Delete") p = { kind: "erase" };
      else if (e.code === "Enter") p = { kind: "note" };
      else {
        const d = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        if (d && rules[Number(d[1]) - 1]) p = { kind: "rule", ruleId: rules[Number(d[1]) - 1].id };
      }
      if (!p) return;
      e.preventDefault();
      withPen(row, col, p);
      if (p.kind !== "note") setCursor({ row: Math.min(rows.length - 1, cur.row + 1), col: cur.col });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (!cursor) return;
    const el = document.querySelector<HTMLElement>(`[data-day-grid] [data-cursor="true"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    // 글쇠로 옮기면 그 칸에 초점도 옮겨, 스페이스·엔터가 커서가 있는 칸에 닿게 한다
    const active = document.activeElement as HTMLElement | null;
    if (el instanceof HTMLButtonElement && (!active || active === document.body || active.closest("[data-day-grid]"))) el.focus({ preventScroll: true });
  }, [cursor]);

  const penLabel = (p: Pen) => (p.kind === "rule" ? (ruleById.get(p.ruleId)?.name ?? "벌점") : p.kind === "na" ? "부재" : p.kind === "erase" ? "지우개" : p.kind === "note" ? "메모·자세히" : p.kind);
  const isPen = (p: Pen) => pen.kind === p.kind && (p.kind !== "rule" || (pen.kind === "rule" && pen.ruleId === p.ruleId));

  function colStatus(c: DayColumn): string | null {
    if (c.kind !== "round") return null;
    if (completed.has(c.roundNo)) return "완료";
    if (filledIn(c) > 0) return "진행 중";
    return null;
  }

  function headerCell(c: DayColumn, i: number) {
    const status = colStatus(c);
    const now = c.kind === "round" && c.roundNo === nowRound;
    return (
      <th key={colId(c)} scope="col" ref={now ? nowRef : undefined} className={cn("sticky top-0 z-20 h-12 min-w-12 border-r border-b border-border bg-card px-0 align-bottom", now && "bg-accent")} data-col={i}>
        <button
          type="button"
          onClick={() => setMenuCol(c)}
          className={cn("flex h-full w-full flex-col items-center justify-end gap-0.5 px-1 pb-1 text-xs font-semibold hover:bg-muted/70 print:pointer-events-none", now && "text-accent-foreground")}
          aria-label={`${c.label} 열 메뉴`}
        >
          <span>{c.label}</span>
          <span className={cn("text-[10px] font-normal", status === "완료" ? "text-success" : "text-muted-foreground")}>
            {/* 빈 표로 인쇄할 때는 완료·진행 중을 지우고 시각만 남긴다 */}
            {c.kind === "auto" ? "자동" : status === "완료" ? <span className="cell-value">완료 ✓</span> : c.time ? c.time : <span className="cell-value">{status ?? " "}</span>}
          </span>
        </button>
      </th>
    );
  }

  const menuStats = menuCol ? { filled: filledIn(menuCol), empty: members.length - filledIn(menuCol) } : null;
  const prevCol = menuCol && menuCol.kind === "round" ? roundCols.find((c) => c.roundNo === menuCol.roundNo - 1) : undefined;
  const prevFilled = prevCol ? filledIn(prevCol) : 0;
  const stepFocus = (d: number) => {
    const editable = columns.filter((c) => c.kind !== "auto");
    const i = editable.findIndex((c) => colId(c) === focus);
    const next = editable[i + d];
    if (next) setFocus(colId(next));
  };
  const chooseBulk = (kind: "copy" | "complete" | "fill", col: DayColumn) => {
    setAsk({ kind, col });
    setMenuCol(null);
  };

  return (
    <div className={cn("day-sheet space-y-3", printBlank && "print-blank")}>
      <style>{PRINT_PAGE}</style>
      {/* 인쇄할 때만 보이는 머리글 */}
      <div className="print-only hidden">
        <p className="text-base font-bold">
          {branchName} 라운딩 표 · {date}
        </p>
        <p className="text-xs">a 양호 · b 사유(자리 없음) · 숫자 벌점 · 부재 — 출석은 라운딩에서 저절로 채워집니다</p>
      </div>

      <div className="day-sheet-tools sticky top-14 z-30 -mx-4 space-y-2 border-b border-border bg-background px-4 py-2 md:-mx-8 md:px-8">
        {canEdit ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5" role="toolbar" aria-label="펜">
            {(
              [
                { kind: "a" },
                { kind: "b" },
                { kind: "na" },
                ...rules.map((r) => ({ kind: "rule", ruleId: r.id }) as Pen),
                { kind: "erase" },
                { kind: "note" },
              ] as Pen[]
            ).map((p, i) => {
              const rule = p.kind === "rule" ? ruleById.get(p.ruleId) : null;
              const on = isPen(p);
              return (
                <button
                  key={p.kind === "rule" ? p.ruleId : p.kind}
                  type="button"
                  onClick={() => setPen(p)}
                  aria-pressed={on}
                  className={cn(
                    "inline-flex h-11 shrink-0 items-center gap-1 rounded-md px-3 text-[13px] font-semibold ring-1",
                    on ? "bg-primary text-primary-foreground ring-primary" : "bg-card text-foreground ring-border hover:bg-muted",
                    i === 2 && "mr-2",
                    p.kind === "erase" && "ml-2",
                  )}
                  title={rule ? `${rule.name} ${rule.points}점 (글쇠 ${rules.indexOf(rule) + 1})` : undefined}
                >
                  {p.kind === "erase" ? <Eraser className="size-4" aria-hidden /> : p.kind === "note" ? <NotebookPen className="size-4" aria-hidden /> : null}
                  {rule ? (
                    <>
                      {rule.name} <span className={cn("text-xs", on ? "text-primary-foreground" : "text-rose-700")}>{rule.points}</span>
                    </>
                  ) : (
                    penLabel(p)
                  )}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="relative w-44">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·좌석" className="h-9 bg-card pl-8" inputMode="search" aria-label="이름 또는 좌석번호로 찾기" />
          </div>
          {canEdit ? (
            <Button type="button" variant="outline" className="h-9" onClick={undoLast} disabled={!undo.length}>
              <Undo2 /> 되돌리기
            </Button>
          ) : null}
          {focused ? (
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="icon" className="size-9" onClick={() => stepFocus(-1)} aria-label="앞 열">
                <ChevronLeft />
              </Button>
              <span className="min-w-12 text-center font-semibold">{focused.label}</span>
              <Button type="button" variant="outline" size="icon" className="size-9" onClick={() => stepFocus(1)} aria-label="다음 열">
                <ChevronRight />
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setFocus(null)}>
                하루 전체 보기
              </Button>
            </div>
          ) : null}
          <span className="text-xs text-muted-foreground">{pending ? "저장 중…" : canEdit ? `펜: ${penLabel(pen)} — 칸을 누르면 적힙니다` : (readOnlyReason ?? "읽기 전용 — 칸을 누르면 메모가 보입니다")}</span>
          {queued > 0 ? (
            <button type="button" onClick={flushQueue} className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
              <CloudOff className="size-3.5" aria-hidden /> 미전송 {queued}건 · 다시 보내기
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <label className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <input type="checkbox" className="size-4" checked={printBlank} onChange={(e) => setPrintBlank(e.target.checked)} /> 빈 표로 인쇄
            </label>
            <PrintButton />
          </div>
        </div>
        {canEdit ? (
          <p className="hidden text-xs text-muted-foreground lg:block">
            PC 글쇠: 화살표로 칸 고르기 · <kbd className="font-semibold text-foreground">A</kbd> <kbd className="font-semibold text-foreground">B</kbd> · <kbd className="font-semibold text-foreground">0</kbd> 부재 · <kbd className="font-semibold text-foreground">1~{Math.min(9, rules.length)}</kbd> 벌점 · <kbd className="font-semibold text-foreground">Del</kbd> 지우기 · <kbd className="font-semibold text-foreground">Enter</kbd> 메모 — 적으면 아래 칸으로 내려갑니다
          </p>
        ) : null}
        {error ? (
          <p className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
            <AlertTriangle className="size-4" aria-hidden /> {error}
          </p>
        ) : notice ? (
          <p className="text-sm text-foreground" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      <div data-day-grid className="day-sheet-wrap overflow-auto rounded-lg border border-border bg-card" style={{ maxHeight: "calc(100vh - 13rem)" }}>
        <table className="border-separate border-spacing-0 text-sm" style={{ minWidth: "100%" }}>
          <thead>
            <tr>
              <th scope="col" className="sticky top-0 left-0 z-30 h-12 w-11 min-w-11 border-r border-b border-border bg-card text-xs font-medium text-muted-foreground">
                좌석
              </th>
              <th scope="col" className="sticky top-0 left-11 z-30 h-12 w-24 min-w-24 border-r border-b border-border bg-card px-2 text-left text-xs font-medium text-muted-foreground">
                이름
              </th>
              {shownCols.map((c, i) => headerCell(c, i))}
              <th scope="col" className="sticky top-0 z-20 h-12 min-w-12 border-b border-border bg-card px-1 text-xs font-medium text-muted-foreground">
                벌점
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m, r) => {
              const zone = m.zone ?? "미배정";
              return (
                <DayRow
                  key={m.memberId}
                  m={m}
                  rowIndex={r}
                  cols={shownCols}
                  rowCells={shownCols.map((c) => cells[cellKey(m.memberId, c.itemKey, c.roundNo)])}
                  cursorCol={cursor?.row === r ? cursor.col : -1}
                  nowRound={nowRound}
                  canEdit={canEdit}
                  big={Boolean(focused)}
                  zoneHeader={r === 0 || (rows[r - 1].zone ?? "미배정") !== zone ? zone : null}
                  valueLabel={valueLabel}
                  onCell={onCell}
                />
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{members.length ? "찾는 학생이 없습니다" : "등록 학생이 없습니다"}</p> : null}
      </div>

      {/* 열 메뉴: 직전 회차 가져오기 · 완료 · 이 열만 크게 */}
      <Dialog open={Boolean(menuCol)} onOpenChange={(o) => !o && setMenuCol(null)}>
        <DialogContent>
          {menuCol ? (
            <>
              <DialogTitle>
                {menuCol.label}
                {menuCol.time ? <span className="ml-2 text-sm font-normal text-muted-foreground">{menuCol.time}</span> : null}
              </DialogTitle>
              <DialogDescription>
                {menuCol.kind === "auto"
                  ? "출석은 따로 적지 않습니다. 라운딩에서 한 번이라도 자리에 있으면 a, 온종일 사유로 자리에 없었으면 b로 저절로 채워집니다."
                  : `적은 칸 ${menuStats?.filled}/${members.length}${colStatus(menuCol) === "완료" ? " · 완료한 회차" : ""}`}
              </DialogDescription>
              {canEdit && menuCol.kind === "round" ? (
                <div className="grid gap-2">
                  {prevCol ? (
                    <Button type="button" variant="outline" className="h-12 justify-start" disabled={!prevFilled || !menuStats?.empty} onClick={() => chooseBulk("copy", menuCol)}>
                      {prevCol.label} 값 가져오기 — 빈 칸 {menuStats?.empty}칸
                    </Button>
                  ) : null}
                  <Button type="button" className="h-12 justify-start" onClick={() => chooseBulk("complete", menuCol)}>
                    {colStatus(menuCol) === "완료" ? `${menuCol.label} 다시 완료` : `${menuCol.label} 완료`}
                    {menuStats?.empty ? ` — 빈 칸 ${menuStats.empty}칸은 a` : ""}
                  </Button>
                </div>
              ) : null}
              {canEdit && menuCol.kind === "daily" && canFillRest(menuCol.itemKey) ? (
                <div className="grid gap-1.5">
                  {/* 아무도 보지 않고 모두 a 가 되지 않게, 한 칸이라도 적은 뒤에 나머지를 채운다 */}
                  <Button type="button" variant="outline" className="h-12 justify-start" disabled={!menuStats?.empty || !menuStats.filled} onClick={() => chooseBulk("fill", menuCol)}>
                    빈 칸 {menuStats?.empty}칸을 a로 채우기
                  </Button>
                  {menuStats && !menuStats.filled ? <p className="text-xs text-muted-foreground">먼저 b·벌점 같은 예외를 한 칸 이상 적은 뒤에 나머지를 a로 채울 수 있습니다.</p> : null}
                </div>
              ) : null}
              {menuCol.kind !== "auto" ? (
                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setFocus(focus === colId(menuCol) ? null : colId(menuCol));
                      setMenuCol(null);
                    }}
                  >
                    {focus === colId(menuCol) ? "하루 전체 보기" : "이 열만 크게 보기"}
                  </Button>
                </DialogFooter>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(ask)} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent>
          {ask ? (
            <>
              <DialogTitle>
                {ask.kind === "copy" ? `R${ask.col.roundNo - 1} 값을 R${ask.col.roundNo}에 가져올까요?` : ask.kind === "complete" ? `${ask.col.label} 회차를 완료할까요?` : `${ask.col.label} 빈 칸을 a로 채울까요?`}
              </DialogTitle>
              <DialogDescription>
                {ask.kind === "copy"
                  ? "비어 있는 칸에만 앞 회차 값(a·b·부재)을 적습니다. 벌점은 옮기지 않고 a로 적습니다. 이미 적은 칸은 그대로이고, 가져온 뒤 달라진 학생만 고치면 됩니다."
                  : ask.kind === "complete"
                    ? `비어 있는 ${members.length - filledIn(ask.col)}칸은 a(자리에 있음)로 적고 완료로 표시합니다. 그 학생들은 출석도 a가 됩니다. 자리에 없던 학생이 있으면 먼저 b나 부재로 적으세요.`
                    : `비어 있는 ${members.length - filledIn(ask.col)}칸이 모두 a가 됩니다. 이미 적은 b·벌점·부재는 그대로입니다.`}
              </DialogDescription>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAsk(null)}>
                  취소
                </Button>
                <Button onClick={() => runBulk(ask.kind, ask.col)}>{ask.kind === "copy" ? "가져오기" : ask.kind === "complete" ? "완료" : "a로 채우기"}</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* 메모·자세히: PC 에서 사유와 메모를 적는 곳 */}
      <Sheet open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {detail ? (
            <>
              <SheetHeader>
                <SheetTitle className="text-lg">
                  <span className="mr-2 font-normal text-muted-foreground">{detail.member.seatNo ?? "-"}번</span>
                  {detail.member.name}
                  <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5 align-middle text-xs font-medium text-muted-foreground">{detail.col.label}</span>
                </SheetTitle>
                <SheetDescription>{detail.member.fieldNote ?? "특이사항 없음"}</SheetDescription>
              </SheetHeader>
              <div className="space-y-5 px-4 pb-5">
                <div className="grid grid-cols-4 gap-2">
                  {(["a", "b", "p", "na"] as Grade[]).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setDetail({ ...detail, draft: { ...detail.draft, grade: g, penaltyRuleId: g === "p" ? (detail.draft.penaltyRuleId ?? suggestRule(detail.member, detail.col)) : null } })}
                      aria-pressed={detail.draft.grade === g}
                      className={cn("h-12 rounded-md text-sm font-semibold ring-1", detail.draft.grade === g ? "bg-primary text-primary-foreground ring-primary" : "bg-card text-foreground ring-border hover:bg-muted")}
                    >
                      {g === "p" ? "벌점" : g === "na" ? "부재" : g}
                    </button>
                  ))}
                </div>
                {detail.draft.grade === "p" ? (
                  <div className="space-y-1.5">
                    <Label>벌점 규칙</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {rules.map((rule) => {
                        const on = detail.draft.penaltyRuleId === rule.id;
                        return (
                          <button
                            key={rule.id}
                            type="button"
                            onClick={() => setDetail({ ...detail, draft: { ...detail.draft, penaltyRuleId: rule.id } })}
                            aria-pressed={on}
                            className={cn("flex h-12 items-center justify-between rounded-md px-3 text-sm ring-1", on ? "bg-rose-50 font-medium text-rose-800 ring-rose-500" : "bg-card ring-border hover:bg-muted/60")}
                          >
                            <span>{rule.name}</span>
                            <span className="text-xs font-semibold">{rule.points}점</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="day-sheet-note">메모</Label>
                  <Textarea id="day-sheet-note" rows={3} value={detail.draft.note} onChange={(e) => setDetail({ ...detail, draft: { ...detail.draft, note: e.target.value } })} placeholder="예: 학원 일정으로 조퇴" />
                </div>
                <label className="flex items-center gap-2.5 rounded-md bg-muted/60 px-3 py-2.5 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={detail.draft.isIssue} onChange={(e) => setDetail({ ...detail, draft: { ...detail.draft, isIssue: e.target.checked } })} />
                  <span className="flex-1">지점장에게 이슈로 보고</span>
                </label>
                <div className="flex gap-2">
                  {at(detail.member.memberId, detail.col) ? (
                    <Button
                      variant="outline"
                      size="lg"
                      className="h-11"
                      onClick={() => {
                        commit(detail.member, detail.col, null);
                        setDetail(null);
                      }}
                    >
                      <Eraser /> 지우기
                    </Button>
                  ) : null}
                  <Button variant="outline" size="lg" className="h-11 flex-1" onClick={() => setDetail(null)}>
                    취소
                  </Button>
                  <Button
                    size="lg"
                    className="h-11 flex-1"
                    disabled={!detail.draft.grade}
                    onClick={() => {
                      const d = detail.draft;
                      if (d.grade) commit(detail.member, detail.col, { grade: d.grade, penaltyRuleId: d.grade === "p" ? d.penaltyRuleId : null, note: d.note.trim() || null, isIssue: d.isIssue });
                      setDetail(null);
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
    </div>
  );
}
