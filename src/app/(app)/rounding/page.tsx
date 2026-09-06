import { Check, History, Play, UserRound } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { getCtx } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { nextRoundNo } from "@/lib/rules/rounding";
import { todayKey } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import { startSessionAction } from "@/modules/rounding/actions";
import { todaySessions } from "@/modules/rounding/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "라운딩" };

async function RoundingHome({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await getCtx();
  const { error } = await searchParams;
  const today = todayKey();
  const sessions = await todaySessions(ctx, today);
  const total = ctx.settings.roundsPerDay;
  const next = nextRoundNo(sessions.map((s) => s.roundNo), total);
  const schedule = ctx.settings.roundSchedule ?? [];
  const inProgress = sessions.find((s) => !s.completedAt);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="라운딩"
        description={`${ctx.branchName} · ${fmtShortDate(today)} · ${sessions.filter((s) => s.completedAt).length}/${total} 회차 완료`}
        actions={
          <>
            {ctx.role === "assistant" ? (
              <Button asChild variant="outline">
                <Link href="/switch">
                  <UserRound /> 전환
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href="/rounding/history">
                <History /> 조회
              </Link>
            </Button>
          </>
        }
      />
      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}

      {inProgress ? (
        <Button asChild size="lg" className="mb-5 h-14 w-full text-base">
          <Link href={`/rounding/${inProgress.id}`}>
            <Play /> R{inProgress.roundNo} 진행 중 · 이어서 입력 ({inProgress.checkedCount}명 완료)
          </Link>
        </Button>
      ) : next ? (
        <form action={startSessionAction} className="mb-5">
          <input type="hidden" name="date" value={today} />
          <Button type="submit" size="lg" className="h-14 w-full text-base">
            <Play /> R{next} 시작{schedule[next - 1] ? ` (${schedule[next - 1]})` : ""}
          </Button>
        </form>
      ) : (
        <p className="mb-5 border-y border-border py-3 text-center text-sm text-muted-foreground">오늘 회차를 모두 진행했습니다</p>
      )}

      <ul className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-border ring-1 ring-border sm:grid-cols-4">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
          const s = sessions.find((x) => x.roundNo === n);
          const state = !s ? "todo" : s.completedAt ? "done" : "active";
          const inner = (
            <div
              className={cn(
                "flex h-[76px] flex-col items-center justify-center gap-0.5 text-sm transition-colors",
                state === "done" && "bg-card text-foreground hover:bg-muted/60",
                state === "active" && "bg-primary text-primary-foreground",
                state === "todo" && "bg-card text-muted-foreground",
              )}
            >
              <span className="flex items-center gap-1 text-[15px] font-semibold">
                R{n}
                {state === "done" ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : null}
              </span>
              <span className={cn("text-[11px]", state === "active" ? "text-primary-foreground/70" : "text-muted-foreground")}>{s ? (s.startedByName ?? "") : (schedule[n - 1] ?? "")}</span>
            </div>
          );
          return <li key={n}>{s ? <Link href={`/rounding/${s.id}`}>{inner}</Link> : inner}</li>;
        })}
      </ul>
    </div>
  );
}

export default guarded(RoundingHome);
