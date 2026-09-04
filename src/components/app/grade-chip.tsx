import type { Grade } from "@/db/schema";
import { cn } from "@/lib/utils";

export const GRADE_LABEL: Record<Grade, string> = { a: "양호", b: "사유", p: "벌점", na: "부재" };

export const GRADE_STYLE: Record<Grade, string> = {
  a: "bg-emerald-500 text-white",
  b: "bg-lime-300 text-lime-950",
  p: "bg-red-500 text-white",
  na: "bg-neutral-300 text-neutral-800",
};

export function GradeChip({ grade, points, className }: { grade: Grade | null; points?: number; className?: string }) {
  if (!grade) return <span className={cn("inline-flex h-6 min-w-8 items-center justify-center rounded border border-dashed text-xs text-muted-foreground", className)}>-</span>;
  return (
    <span className={cn("inline-flex h-6 min-w-8 items-center justify-center rounded px-1.5 text-xs font-semibold", GRADE_STYLE[grade], className)}>
      {grade === "p" ? points ?? "벌" : grade === "na" ? "부재" : grade}
    </span>
  );
}
