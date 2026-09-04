import { Badge } from "@/components/ui/badge";
import type { IssueStatus } from "@/db/schema";
import { cn } from "@/lib/utils";
import { ISSUE_STATUS_LABEL, SEVERITY_LABEL } from "@/modules/issues/repo";

const STATUS_STYLE: Record<IssueStatus, string> = {
  open: "bg-red-100 text-red-800",
  in_progress: "bg-amber-100 text-amber-800",
  resolved: "bg-emerald-100 text-emerald-800",
};
const SEV_STYLE: Record<string, string> = {
  low: "bg-neutral-100 text-neutral-700",
  normal: "bg-sky-100 text-sky-800",
  high: "bg-red-600 text-white",
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
