import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCtx } from "@/lib/auth/ctx";
import { fmtDateTime } from "@/lib/format";
import { listAuditLogs } from "@/modules/settings/repo";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "감사 로그" };

const ENTITY_LABEL: Record<string, string> = {
  member: "회원",
  branch: "지점",
  issue: "이슈",
  user: "사용자",
  check: "라운딩·체크",
  counsel_log: "상담일지",
  counsel_appointment: "상담 일정",
  meal_order: "식사 주문",
  meal_settings: "식사 설정",
  meal_settlement: "식사 정산",
  seat_payment: "좌석 결제",
  work_log: "근무 기록",
  staff_profile: "직원 근무 정보",
  shift_slot: "근무 타임",
};
const ACTION_LABEL: Record<string, string> = { create: "생성", update: "수정", status: "상태 변경", seat: "좌석 변경", delete: "삭제" };

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

async function AuditPage() {
  const ctx = await getCtx();
  const rows = await listAuditLogs(ctx);
  return (
    <Card>
      <CardHeader>
        <CardTitle>감사 로그 (최근 {rows.length}건)</CardTitle>
        <CardDescription>회원·이슈·설정·사용자의 변경 이력입니다. 삭제되지 않습니다.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">기록이 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">일시</th>
                  <th className="py-1 pr-3">행위자</th>
                  <th className="py-1 pr-3">대상</th>
                  <th className="py-1 pr-3">동작</th>
                  <th className="py-1 pr-3">변경 전</th>
                  <th className="py-1">변경 후</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{fmtDateTime(r.at)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{r.actorName ?? "-"}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{ENTITY_LABEL[r.entity] ?? r.entity}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{ACTION_LABEL[r.action] ?? r.action}</td>
                    <td className="max-w-64 py-1.5 pr-3 break-all text-xs text-muted-foreground">{fmt(r.before)}</td>
                    <td className="max-w-64 py-1.5 break-all text-xs">{fmt(r.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default guarded(AuditPage);
