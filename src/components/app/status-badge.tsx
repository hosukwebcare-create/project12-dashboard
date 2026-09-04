import { Badge } from "@/components/ui/badge";
import type { MemberStatus } from "@/db/schema";
import { STATUS_LABEL } from "@/modules/members/schema";
import { cn } from "@/lib/utils";

const STYLE: Record<MemberStatus, string> = {
  enrolled: "bg-emerald-100 text-emerald-800 border-transparent",
  prospect: "bg-sky-100 text-sky-800 border-transparent",
  paused: "bg-amber-100 text-amber-800 border-transparent",
  withdrawn: "bg-neutral-200 text-neutral-700 border-transparent",
};

export function StatusBadge({ status, className }: { status: MemberStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(STYLE[status], className)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function FocusBadge() {
  return (
    <Badge variant="outline" className="border-transparent bg-violet-100 text-violet-800">
      집중관리
    </Badge>
  );
}
