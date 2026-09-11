import { CheckCircle2, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { AttentionItem, AttentionLevel } from "@/lib/rules/attention";
import { cn } from "@/lib/utils";

/** 급한 정도를 점 하나의 색으로. 글자 색은 바꾸지 않아 목록이 조용하다 */
const DOT: Record<AttentionLevel, string> = {
  urgent: "bg-destructive",
  warning: "bg-warning",
  info: "bg-primary",
};
const LEVEL_LABEL: Record<AttentionLevel, string> = { urgent: "긴급", warning: "주의", info: "참고" };

/**
 * 대시보드 첫 블록. 여러 화면의 수치를 "지금 할 일" 한 줄씩으로 바꿔 급한 순으로 보인다.
 * 각 줄은 그 일을 처리하는 화면으로 바로 간다.
 */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  const urgent = items.filter((i) => i.level === "urgent").length;
  return (
    <section aria-labelledby="attention-title" className="overflow-hidden rounded-lg bg-card ring-1 ring-border">
      <header className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-3">
        <h2 id="attention-title" className="text-sm font-semibold">
          오늘 챙길 것
        </h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          {items.length === 0 ? "없음" : urgent > 0 ? `${items.length}건 · 긴급 ${urgent}` : `${items.length}건`}
        </p>
      </header>
      {items.length === 0 ? (
        <p className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          오늘 챙길 것이 없습니다. 다 처리됐습니다.
        </p>
      ) : (
        <ol className="divide-y divide-border">
          {items.map((it) => (
            <li key={it.key}>
              <Link href={it.href} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40">
                <span className={cn("size-2 shrink-0 rounded-full", DOT[it.level])} aria-hidden />
                <span className="sr-only">{LEVEL_LABEL[it.level]}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", it.level === "urgent" ? "font-semibold" : "font-medium")}>{it.title}</span>
                  {it.detail ? <span className="block truncate text-xs text-muted-foreground">{it.detail}</span> : null}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
