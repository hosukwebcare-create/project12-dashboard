import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { getCtx, requireRole, STAFF_ROLES } from "@/lib/auth/ctx";
import { fmtShortDate } from "@/lib/format";
import { addDays, toDateKey, todayKey } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import { focusDailyGrid, gridMembers } from "@/modules/counsel/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "집중관리 일지" };

async function FocusCounselPage({ searchParams }: { searchParams: Promise<{ memberId?: string }> }) {
  const ctx = await getCtx();
  requireRole(ctx, ...STAFF_ROLES);
  const sp = await searchParams;
  const members = await gridMembers(ctx, true);
  const selected = members.find((m) => m.id === sp.memberId) ?? members[0];
  const dates = Array.from({ length: 14 }, (_, i) => toDateKey(addDays(todayKey(), -i)));
  const cells = selected ? await focusDailyGrid(ctx, selected.id, dates) : {};

  return (
    <div>
      <PageHeader
        title="집중관리 개인 일지"
        description={`${ctx.branchName} · 집중관리 대상 ${members.length}명`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/counsel/weekly">주간 상담일지</Link>
          </Button>
        }
      />
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">집중관리 대상 회원이 없습니다. 회원 정보에서 집중관리를 지정하세요.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
          <ul className="flex gap-2 overflow-x-auto md:flex-col">
            {members.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/counsel/focus?memberId=${m.id}`}
                  className={cn("block whitespace-nowrap rounded-md border px-3 py-2 text-sm", m.id === selected?.id ? "bg-foreground text-background" : "hover:bg-muted")}
                >
                  {m.seatNo ?? "-"}번 · {m.name}
                </Link>
              </li>
            ))}
          </ul>
          {selected ? (
            <div className="rounded-lg border">
              <div className="border-b px-3 py-2 text-sm font-medium">
                {selected.name} · {selected.school ?? ""} {selected.grade ?? ""}
              </div>
              <ul className="divide-y">
                {dates.map((d) => {
                  const c = cells[d];
                  const href = c ? `/counsel/logs/${c.logId}` : `/counsel/entry?memberId=${selected.id}&logType=focus_daily&periodDate=${d}`;
                  return (
                    <li key={d}>
                      <Link href={href} className="grid grid-cols-[5rem_1fr_1fr] gap-2 px-3 py-2 text-sm hover:bg-muted/60">
                        <span className="tabular-nums text-muted-foreground">{fmtShortDate(d)}</span>
                        <span className={cn("truncate", !c?.issueText && "text-muted-foreground")}>{c?.issueText ?? "원장: 미작성"}</span>
                        <span className={cn("truncate", !c?.resolutionText && "text-muted-foreground")}>{c?.resolutionText ?? "멘토: 미작성"}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default guarded(FocusCounselPage);
