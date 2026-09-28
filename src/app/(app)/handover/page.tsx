import { InlineForm } from "@/components/app/inline-form";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCtx, MANAGER_ROLES } from "@/lib/auth/ctx";
import { fmtDateTime, fmtShortDate } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { todayKey } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import { addCommentAction, markAllReadAction, markReadAction, setRequestDoneAction, upsertNoteAction, deleteNoteAction } from "@/modules/handover/actions";
import { HANDOVER_KINDS, listComments, listNotes, listRequests, slotOptions } from "@/modules/handover/repo";

export const metadata = { title: "인수인계" };

const SELECT = "h-9 rounded-lg border border-input bg-card px-2.5 text-sm";

async function HandoverPage() {
  const ctx = await getCtx();
  const [notes, slots, requests] = await Promise.all([listNotes(ctx), slotOptions(ctx), listRequests(ctx)]);
  const unread = notes.filter((n) => n.unread);
  const canNotice = MANAGER_ROLES.includes(ctx.role);
  // 댓글은 글마다 몇 개 안 되므로 한 번에 읽어 온다
  const comments = await Promise.all(notes.filter((n) => n.commentCount > 0).map(async (n) => [n.id, await listComments(ctx, n.id)] as const));
  const commentsBy = new Map(comments);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="인수인계"
        description={`${ctx.branchName} · 최근 2주${unread.length ? ` · 안 읽은 글 ${unread.length}건` : ""}`}
        actions={
          unread.length ? (
            <form action={markAllReadAction}>
              <Button type="submit" variant="outline" size="sm">
                모두 읽음
              </Button>
            </form>
          ) : null
        }
      />

      <Card id="requests">
        <CardHeader>
          <CardTitle>
            해 주세요 <span className="ml-1 text-sm font-normal text-muted-foreground">남은 일 {requests.open.length}건</span>
          </CardTitle>
          <CardDescription>다음 사람에게 맡길 일을 적습니다. 적으면 지점 사람 모두에게 알림이 가고, 누가 해 놓고 &lsquo;했어요&rsquo;를 누르면 부탁한 사람에게 알림이 가며 아래로 내려갑니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <InlineForm action={upsertNoteAction} submitLabel="맡기기" className="flex-wrap items-end gap-2">
            <input type="hidden" name="kind" value="request" />
            <input type="hidden" name="date" value={todayKey()} />
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="request-body">무엇을 해 주면 되나요?</Label>
              <Input id="request-body" name="body" required placeholder="예: 3층 정수기 필터 교체 업체에 전화해 주세요" />
            </div>
          </InlineForm>
          {requests.open.length === 0 ? (
            <p className="text-sm text-muted-foreground">남은 일이 없습니다</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {requests.open.map((r) => (
                <li key={r.id} id={r.id} className="flex items-start gap-3 px-3 py-2.5">
                  <form action={setRequestDoneAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="done" value="1" />
                    <Button type="submit" size="sm" variant="outline" aria-label={`했어요: ${r.body.slice(0, 30)}`}>
                      했어요
                    </Button>
                  </form>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm whitespace-pre-wrap">{r.body}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.authorName ?? "(알 수 없음)"} · {fmtShortDate(r.date)}
                      {r.slotName ? ` · ${r.slotName}에게` : ""}
                    </p>
                  </div>
                  {/* 잘못 올린 부탁은 쓴 사람(과 지점장)이 지운다 */}
                  {r.authorId === ctx.userId || canNotice ? (
                    <InlineForm action={deleteNoteAction} submitLabel="삭제">
                      <input type="hidden" name="id" value={r.id} />
                    </InlineForm>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {requests.done.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">최근 해 놓은 일 {requests.done.length}건</summary>
              <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                {requests.done.map((r) => (
                  <li key={r.id} id={r.id} className="flex items-start gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-muted-foreground line-through">{r.body}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.doneByName ?? "누군가"} · {r.doneAt ? fmtDateTime(r.doneAt) : ""}에 해 놓음 (부탁: {r.authorName ?? "-"})
                      </p>
                    </div>
                    <form action={setRequestDoneAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="done" value="0" />
                      <Button type="submit" size="xs" variant="ghost">
                        되돌리기
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>새 글</CardTitle>
          <CardDescription>
            다음 타임 사람이 알아야 할 것을 남깁니다. 로그인하면 자기가 근무하지 않은 사이에 올라온 글이 <b>안 읽음</b>으로 표시됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InlineForm action={upsertNoteAction} submitLabel="남기기" className="flex-col items-stretch gap-3">
            <Textarea name="body" rows={3} required placeholder="예: 12번 자리 스탠드 깜빡임, 관리업체 연락함. 내일 오전 방문 예정" />
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="date">날짜</Label>
                <Input id="date" name="date" type="date" defaultValue={todayKey()} className="w-40" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="slotKey">근무 타임</Label>
                <select id="slotKey" name="slotKey" className={cn(SELECT, "w-36")} defaultValue="">
                  <option value="">지정 안 함</option>
                  {slots.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="kind">종류</Label>
                <select id="kind" name="kind" className={cn(SELECT, "w-28")} defaultValue="handover">
                  {HANDOVER_KINDS.filter((k) => k.key !== "request" && (k.key !== "notice" || canNotice)).map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </InlineForm>
        </CardContent>
      </Card>

      {notes.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">아직 남긴 글이 없습니다</p>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <Card key={n.id} id={n.id} className={cn(n.kind === "notice" && "ring-primary/40", n.unread && "ring-2 ring-primary")}>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {n.kind === "notice" ? <span className="rounded-sm bg-primary/10 px-1.5 py-px font-medium text-primary">공지</span> : null}
                  {n.unread ? <span className="rounded-sm bg-primary px-1.5 py-px font-medium text-primary-foreground">안 읽음</span> : null}
                  <span className="font-medium text-foreground">{n.authorName ?? "(알 수 없음)"}</span>
                  <span>{fmtShortDate(n.date)}</span>
                  {n.slotName ? <span>· {n.slotName}</span> : null}
                  <span>· {fmtDateTime(n.createdAt)}</span>
                  <span className="ml-auto">읽음 {n.readCount}</span>
                </div>

                <p className="text-sm leading-relaxed whitespace-pre-wrap">{n.body}</p>

                {(commentsBy.get(n.id) ?? []).length ? (
                  <ul className="divide-y divide-border border-t border-border pt-1">
                    {(commentsBy.get(n.id) ?? []).map((c) => (
                      <li key={c.id} className="py-2 text-sm">
                        <span className="mr-2 font-medium">{c.authorName ?? "(알 수 없음)"}</span>
                        <span className="text-xs text-muted-foreground">{fmtDateTime(c.createdAt)}</span>
                        <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                  <InlineForm action={addCommentAction} submitLabel="답글">
                    <input type="hidden" name="noteId" value={n.id} />
                    <Input name="body" placeholder="답글" className="w-64" required />
                  </InlineForm>
                  {n.unread ? (
                    <InlineForm action={markReadAction} submitLabel="읽음">
                      <input type="hidden" name="id" value={n.id} />
                    </InlineForm>
                  ) : null}
                  {n.authorId === ctx.userId || canNotice ? (
                    <InlineForm action={deleteNoteAction} submitLabel="삭제">
                      <input type="hidden" name="id" value={n.id} />
                    </InlineForm>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default guarded(HandoverPage);
