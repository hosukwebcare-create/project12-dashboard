import { InlineForm } from "@/components/app/inline-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCtx } from "@/lib/auth/ctx";
import { fmtDateTime } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { cn } from "@/lib/utils";
import { dispatchNowAction, upsertWebhookAction } from "@/modules/outbox/actions";
import { listWebhookEndpoints, OUTBOX_EVENTS, recentEvents } from "@/modules/outbox/repo";

export const metadata = { title: "메신저 연동" };

async function WebhooksPage() {
  const ctx = await getCtx();
  const [endpoints, events] = await Promise.all([listWebhookEndpoints(ctx), recentEvents(ctx)]);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>메신저 웹훅</CardTitle>
          <CardDescription>사내 메신저(Rocket.Chat·Mattermost·Slack 등)의 인커밍 웹훅 URL을 등록하면 이슈 보고·고벌점 같은 이벤트가 지점 채널로 자동 게시됩니다.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {endpoints.map((w) => (
            <InlineForm key={w.id} action={upsertWebhookAction} className="py-2">
              <input type="hidden" name="id" value={w.id} />
              <Input name="name" defaultValue={w.name} className="w-36" />
              <Input name="url" defaultValue={w.url} className="w-80" />
              <EventChecks selected={w.events} />
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="active" defaultChecked={w.active} className="size-4" /> 사용
              </label>
            </InlineForm>
          ))}
          <div className="pt-3">
            <p className="mb-1 text-xs text-muted-foreground">새 웹훅</p>
            <InlineForm action={upsertWebhookAction} submitLabel="추가">
              <input type="hidden" name="active" value="true" />
              <Input name="name" placeholder="채널 이름" className="w-36" required />
              <Input name="url" placeholder="https://chat.example.com/hooks/…" className="w-80" required />
              <EventChecks selected={["issue.created", "penalty.high"]} />
            </InlineForm>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">최근 이벤트</CardTitle>
          <CardDescription>운영에서는 배치(/api/jobs/outbox)가 주기적으로 전송합니다. 아래 버튼으로 지금 바로 보낼 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={dispatchNowAction} className="mb-3">
            <Button type="submit" variant="outline" size="sm">
              대기·실패 이벤트 지금 전송
            </Button>
          </form>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">이벤트가 없습니다</p>
          ) : (
            <ul className="divide-y text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className={cn("rounded px-1.5 text-xs", e.status === "sent" ? "bg-emerald-100 text-emerald-800" : e.status === "failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800")}>{e.status === "sent" ? "전송" : e.status === "failed" ? "실패" : "대기"}</span>
                  <span className="text-xs text-muted-foreground">{fmtDateTime(e.sentAt ?? e.createdAt)}</span>
                  <span className="truncate">{e.text}</span>
                  {e.lastError ? <span className="text-xs text-destructive">{e.lastError}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EventChecks({ selected }: { selected: string[] }) {
  return (
    <>
      {OUTBOX_EVENTS.map((e) => (
        <label key={e.key} className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="events" value={e.key} defaultChecked={selected.includes(e.key)} className="size-4" /> {e.label}
        </label>
      ))}
    </>
  );
}

export default guarded(WebhooksPage);
