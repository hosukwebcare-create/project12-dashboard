import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCtx, requireRole } from "@/lib/auth/ctx";
import { fmtDateTime } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { describeUserAgent } from "@/lib/rules/user-agent";
import { ALERT_KINDS, failureHotspots, listSecurityEvents, SECURITY_EVENT_LABEL, type FailureHotspot } from "@/modules/security/events";

export const metadata = { title: "보안 기록" };
export const dynamic = "force-dynamic";

/** 실패가 이만큼 몰리면 무작위 대입 시도로 보고 붉게 표시한다 */
const HOT = 10;

function Hotspots({ title, rows, empty }: { title: string; rows: FailureHotspot[]; empty: string }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
              <span className="truncate font-mono text-[13px]">{r.key}</span>
              <span className={`shrink-0 tabular-nums ${r.failures >= HOT ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                {r.failures}회 · {fmtDateTime(r.last)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 본사: 로그인 성공·실패·잠김, PIN 전환, 강제 로그아웃, 비밀번호 변경 기록 */
async function SecurityPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await getCtx();
  requireRole(ctx, "hq_admin");
  const { filter } = await searchParams;
  const alertsOnly = filter === "alerts";
  const [rows, hot] = await Promise.all([listSecurityEvents(ctx, { kinds: alertsOnly ? ALERT_KINDS : undefined, limit: 300 }), failureHotspots(ctx)]);
  const alert = new Set<string>(ALERT_KINDS);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>최근 24시간 실패</CardTitle>
          <CardDescription>
            로그인·PIN 실패가 몰린 곳입니다. 한 IP 에서 아이디를 바꿔 가며 실패하면 무작위 대입 시도입니다 — 계정은 5회, IP 는 20회 실패에서 자동으로 막힙니다. 낯선 IP 에서 성공한 기록이
            있으면 그 사람의 기기를 모두 로그아웃시키고 비밀번호를 바꾸세요(설정 › 사용자).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row">
          <Hotspots title="IP 별" rows={hot.byIp} empty="실패 없음" />
          <Hotspots title="입력한 아이디 별" rows={hot.byLoginId} empty="실패 없음" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>보안 기록 (최근 {rows.length}건)</CardTitle>
          <CardDescription>
            비밀번호·PIN 은 어떤 형태로도 남기지 않습니다. 1년이 지난 기록은 자동으로 지워집니다.{" "}
            {alertsOnly ? (
              <Link href="/settings/security" className="underline underline-offset-2">
                모두 보기
              </Link>
            ) : (
              <Link href="/settings/security?filter=alerts" className="underline underline-offset-2">
                실패·잠김만 보기
              </Link>
            )}
          </CardDescription>
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
                    <th className="py-1 pr-3">종류</th>
                    <th className="py-1 pr-3">계정</th>
                    <th className="py-1 pr-3">한 사람</th>
                    <th className="py-1 pr-3">IP</th>
                    <th className="py-1">기기</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{fmtDateTime(r.at)}</td>
                      <td className={`py-1.5 pr-3 whitespace-nowrap ${alert.has(r.kind) ? "font-medium text-destructive" : ""}`}>{SECURITY_EVENT_LABEL[r.kind] ?? r.kind}</td>
                      <td className="py-1.5 pr-3">
                        {r.userName ?? <span className="text-muted-foreground">없는 계정</span>}
                        {r.loginId ? <span className="ml-1.5 font-mono text-xs text-muted-foreground">{r.loginId}</span> : null}
                      </td>
                      <td className="py-1.5 pr-3">{r.actorName ?? ""}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">{r.ip ?? ""}</td>
                      <td className="py-1.5 text-xs text-muted-foreground">{r.userAgent ? describeUserAgent(r.userAgent) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default guarded(SecurityPage);
