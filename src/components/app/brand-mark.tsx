import { cn } from "@/lib/utils";

/** 별하 심볼: 가는 선으로 그린 별 하나. 상자 없이 글자와 나란히 놓는다 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5 text-brand", className)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.2l2.5 5.6 6.1.6-4.6 4.1 1.4 6-5.4-3.2-5.4 3.2 1.4-6L3.4 9.4l6.1-.6L12 3.2z" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
