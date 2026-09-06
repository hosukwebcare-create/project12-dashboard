import { Badge } from "@/components/ui/badge";
import type { MemberStatus } from "@/db/schema";
import { STATUS_LABEL } from "@/modules/members/schema";
import { cn } from "@/lib/utils";

/** 상태 배지: 연한 바탕 + 같은 색 점. 색은 상태 의미에 고정 (등록 초록, 상담 파랑, 휴원 호박, 퇴원 회색) */
const STYLE: Record<MemberStatus, { badge: string; dot: string }> = {
  enrolled: { badge: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/15", dot: "bg-emerald-500" },
  prospect: { badge: "bg-sky-50 text-sky-800 ring-1 ring-sky-600/15", dot: "bg-sky-500" },
  paused: { badge: "bg-amber-50 text-amber-800 ring-1 ring-amber-600/20", dot: "bg-amber-500" },
  withdrawn: { badge: "bg-muted text-muted-foreground ring-1 ring-foreground/10", dot: "bg-muted-foreground/60" },
};

export function StatusBadge({ status, className }: { status: MemberStatus; className?: string }) {
  const st = STYLE[status];
  return (
    <Badge variant="outline" className={cn("gap-1.5 border-transparent", st.badge, className)}>
      <span className={cn("size-1.5 rounded-full", st.dot)} aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function FocusBadge() {
  return (
    <Badge variant="outline" className="gap-1.5 border-transparent bg-violet-50 text-violet-800 ring-1 ring-violet-600/15">
      <span className="size-1.5 rounded-full bg-violet-500" aria-hidden />
      집중관리
    </Badge>
  );
}
