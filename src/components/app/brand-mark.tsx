import { cn } from "@/lib/utils";

/** 별하 심볼: 잉크 네이비 바탕에 황동 별 하나 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center justify-center rounded-lg bg-primary text-brand shadow-(--shadow-card)", className)} aria-hidden>
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="currentColor">
        <path d="M12 2.5l2.4 6.1 6.6.4-5.1 4.2 1.7 6.4L12 16l-5.6 3.6 1.7-6.4L3 9l6.6-.4L12 2.5z" />
      </svg>
    </span>
  );
}
