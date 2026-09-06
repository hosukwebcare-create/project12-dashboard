import { Badge } from "@/components/ui/badge";
import type { IssueStatus } from "@/db/schema";
import { cn } from "@/lib/utils";
import { ISSUE_STATUS_LABEL, SEVERITY_LABEL } from "@/modules/issues/repo";

/** 상태·심각도 태그. 옅은 바탕에 글자만, 긴급만 글자를 굵게 */
const STATUS_STYLE: Record<IssueStatus, string> = {
  open: "bg-rose-50 text-rose-800",
  in_progress: "bg-amber-50 text-amber-800",
  resolved: "bg-emerald-50 text-emerald-800",
};
const SEV_STYLE: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-sky-50 text-sky-800",
  high: "bg-rose-100 font-semibold text-rose-900",
};

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", STATUS_STYLE[status])}>
      {ISSUE_STATUS_LABEL[status]}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", SEV_STYLE[severity] ?? SEV_STYLE.normal)}>
      {SEVERITY_LABEL[severity] ?? severity}
    </Badge>
  );
}
