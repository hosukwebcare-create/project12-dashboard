import { Badge } from "@/components/ui/badge";
import type { MemberStatus } from "@/db/schema";
import { STATUS_LABEL } from "@/modules/members/schema";
import { cn } from "@/lib/utils";

/** 상태 태그. 옅은 바탕에 글자만, 색은 상태 의미에 고정 (등록 초록, 상담 파랑, 휴원 호박, 퇴원 회색) */
const STYLE: Record<MemberStatus, string> = {
  enrolled: "bg-emerald-50 text-emerald-800",
  prospect: "bg-sky-50 text-sky-800",
  paused: "bg-amber-50 text-amber-800",
  withdrawn: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status, className }: { status: MemberStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("rounded-sm border-transparent px-1.5 font-medium", STYLE[status], className)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function FocusBadge() {
  return (
    <Badge variant="outline" className="rounded-sm border-transparent bg-violet-50 px-1.5 font-medium text-violet-800">
      집중관리
    </Badge>
  );
}
