import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** 대시보드 지표 카드: 아이콘 · 라벨 · 큰 숫자 · 단위 · 링크 */
export function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  hint,
  href,
  tone = "default",
  className,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value?: ReactNode;
  unit?: string;
  hint?: string;
  href?: string;
  tone?: "default" | "warning" | "danger";
  className?: string;
  children?: ReactNode;
}) {
  const toneCls = { default: "bg-accent text-accent-foreground", warning: "bg-amber-50 text-amber-700", danger: "bg-rose-50 text-rose-700" }[tone];
  return (
    <Card className={cn("gap-3 px-5 py-4", className)}>
      <div className="flex items-center justify-between">
        <span className="section-title">{label}</span>
        <span className={cn("flex size-8 items-center justify-center rounded-lg", toneCls)}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      {value !== undefined ? (
        <p className="text-[32px] leading-none font-semibold tracking-tight">
          {value}
          {unit ? <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span> : null}
        </p>
      ) : null}
      {children}
      {href && hint ? (
        <Link href={href} className="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          {hint} →
        </Link>
      ) : hint ? (
        <p className="text-[13px] text-muted-foreground">{hint}</p>
      ) : null}
    </Card>
  );
}
