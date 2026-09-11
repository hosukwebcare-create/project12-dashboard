import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 요약 띠의 칸 하나. 라벨은 작게, 숫자는 22px — 큰 숫자 타일이 아니라 시트 맨 위의 합계 줄에 가깝다.
 * 여러 개를 `md:grid-cols-N md:divide-x` 상자 안에 나란히 둔다.
 */
export function StatCard({ label, value, unit, hint, href, tone = "default", className, children }: { label: string; value?: ReactNode; unit?: string; hint?: string; href?: string; tone?: "default" | "warning"; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5 px-4 py-3", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      {value !== undefined ? (
        <p className={cn("text-[22px] leading-none font-semibold tracking-tight tabular-nums", tone === "warning" && "text-warning")}>
          {value}
          {unit ? <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span> : null}
        </p>
      ) : null}
      {children}
      {href && hint ? (
        <Link href={href} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          {hint}
        </Link>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
