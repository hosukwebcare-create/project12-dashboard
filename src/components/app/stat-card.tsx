import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 대시보드 지표. 아이콘 없이 라벨 · 숫자 · 보조 링크만. 여러 개를 나란히 두면 사이에 얇은 세로선이 생긴다.
 */
export function StatCard({ label, value, unit, hint, href, tone = "default", className, children }: { label: string; value?: ReactNode; unit?: string; hint?: string; href?: string; tone?: "default" | "warning"; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-2 py-1 md:px-6 md:first:pl-0 md:last:pr-0 md:not-first:border-l md:not-first:border-border", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      {value !== undefined ? (
        <p className={cn("text-[34px] leading-none font-semibold tracking-tight", tone === "warning" && "text-warning")}>
          {value}
          {unit ? <span className="ml-1.5 text-sm font-normal text-muted-foreground">{unit}</span> : null}
        </p>
      ) : null}
      {children}
      {href && hint ? (
        <Link href={href} className="text-[13px] text-muted-foreground hover:text-foreground hover:underline">
          {hint}
        </Link>
      ) : hint ? (
        <p className="text-[13px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
