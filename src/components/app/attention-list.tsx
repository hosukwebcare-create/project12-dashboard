import Link from "next/link";
import type { AttentionItem, AttentionLevel } from "@/lib/rules/attention";
import { cn } from "@/lib/utils";

/** 급한 정도는 작은 네모 표지로. 업무 시스템의 '미처리' 표지와 같은 문법이다 */
const TAG: Record<AttentionLevel, { label: string; cls: string }> = {
  urgent: { label: "긴급", cls: "bg-destructive text-white" },
  warning: { label: "주의", cls: "bg-warning text-white" },
  info: { label: "참고", cls: "bg-muted text-muted-foreground" },
};

/**
 * 대시보드 첫 블록. 여러 화면의 수치를 "지금 할 일" 한 줄씩으로 바꿔 급한 순으로 보인다.
 * 줄마다 오른쪽에 처리 화면 이름이 있어 어디로 가는지 누르기 전에 안다.
 */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  const urgent = items.filter((i) => i.level === "urgent").length;
  return (
    <section aria-labelledby="attention-title" className="overflow-hidden rounded-md bg-card ring-1 ring-border">
      <header className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-2">
        <h2 id="attention-title" className="text-[13px] font-bold">
          오늘 챙길 것
        </h2>
        <p className="text-xs text-muted-foreground tabular-nums">{items.length === 0 ? "없음" : urgent > 0 ? `${items.length}건 · 긴급 ${urgent}` : `${items.length}건`}</p>
      </header>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">오늘 챙길 것이 없습니다.</p>
      ) : (
        <ol className="divide-y divide-border">
          {items.map((it) => (
            <li key={it.key}>
              <Link href={it.href} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2 text-sm transition-colors hover:bg-accent/40 focus-visible:bg-accent/40">
                <span className={cn("inline-block rounded-[2px] py-px text-center text-[11px] font-bold", TAG[it.level].cls)}>{TAG[it.level].label}</span>
                <span className="min-w-0">
                  <span className={cn("block", it.level === "urgent" ? "font-semibold" : "font-medium")}>{it.title}</span>
                  {it.detail ? <span className="block truncate text-xs text-muted-foreground">{it.detail}</span> : null}
                </span>
                <span className="text-xs whitespace-nowrap text-muted-foreground">{it.target} ›</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
