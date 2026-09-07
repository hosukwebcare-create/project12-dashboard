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
import { addCommentAction, markAllReadAction, markReadAction, upsertNoteAction, deleteNoteAction } from "@/modules/handover/actions";
import { HANDOVER_KINDS, listComments, listNotes, slotOptions } from "@/modules/handover/repo";

export const metadata = { title: "인수인계" };

const SELECT = "h-9 rounded-lg border border-input bg-card px-2.5 text-sm";

async function HandoverPage() {
  const ctx = await getCtx();
  const [notes, slots] = await Promise.all([listNotes(ctx), slotOptions(ctx)]);
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
                  {HANDOVER_KINDS.filter((k) => k.key !== "notice" || canNotice).map((k) => (
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
