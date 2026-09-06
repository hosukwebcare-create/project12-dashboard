"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renderTemplate } from "@/lib/rules/template";
import { sendAlimtalkAction, type SendState } from "@/modules/alimtalk/actions";

type Tpl = { id: string; name: string; body: string; variables: string[] };
type Member = { id: string; name: string; seatNo: number | null; focusCare: boolean; hasPhone: boolean; hasGuardianPhone: boolean };

const AUTO_VARS = ["이름", "지점", "좌석"];

export function AlimtalkComposer({ templates, members, branchName, providerName }: { templates: Tpl[]; members: Member[]; branchName: string; providerName: string }) {
  const [tplId, setTplId] = useState(templates[0]?.id ?? "");
  const [group, setGroup] = useState<"all" | "focus" | "members">("all");
  const [recipientType, setRecipientType] = useState<"member" | "guardian">("member");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [vars, setVars] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState<SendState, FormData>(sendAlimtalkAction, {});
  const tpl = templates.find((t) => t.id === tplId);
  const extraVarNames = (tpl?.variables ?? []).filter((v) => !AUTO_VARS.includes(v));

  const targets = useMemo(() => {
    const base = group === "all" ? members : group === "focus" ? members.filter((m) => m.focusCare) : members.filter((m) => picked.has(m.id));
    const reachable = base.filter((m) => (recipientType === "guardian" ? m.hasGuardianPhone : m.hasPhone));
    return { total: base.length, reachable: reachable.length, sample: base[0] };
  }, [group, members, picked, recipientType]);

  const preview = tpl ? renderTemplate(tpl.body, { 이름: targets.sample?.name ?? "홍길동", 지점: branchName, 좌석: targets.sample?.seatNo ? String(targets.sample.seatNo) : "", ...vars }) : "";

  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">활성 템플릿이 없습니다. 본사 관리자가 설정 › 알림톡 템플릿에서 등록해야 합니다.</p>;
  }

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>템플릿</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <select name="templateId" value={tplId} onChange={(e) => setTplId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm" aria-label="템플릿">
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {extraVarNames.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {extraVarNames.map((v) => (
                  <div key={v} className="space-y-1">
                    <Label htmlFor={`var-${v}`}>#{`{${v}}`}</Label>
                    <Input id={`var-${v}`} name={`var.${v}`} value={vars[v] ?? ""} onChange={(e) => setVars({ ...vars, [v]: e.target.value })} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">이름·지점·좌석은 회원별로 자동 채워집니다.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>대상</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3 text-sm">
              {(["all", "focus", "members"] as const).map((g) => (
                <label key={g} className="flex items-center gap-1">
                  <input type="radio" name="group" value={g} checked={group === g} onChange={() => setGroup(g)} /> {g === "all" ? "지점 전체" : g === "focus" ? "집중관리 회원" : "직접 선택"}
                </label>
              ))}
              <span className="mx-2 text-muted-foreground">|</span>
              {(["member", "guardian"] as const).map((r) => (
                <label key={r} className="flex items-center gap-1">
                  <input type="radio" name="recipientType" value={r} checked={recipientType === r} onChange={() => setRecipientType(r)} /> {r === "member" ? "회원 본인" : "학부모"}
                </label>
              ))}
            </div>
            {group === "members" ? (
              <div className="grid max-h-56 grid-cols-2 gap-1 overflow-auto rounded-md border p-2 sm:grid-cols-3">
                {members.map((m) => (
                  <label key={m.id} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      name="memberId"
                      value={m.id}
                      checked={picked.has(m.id)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(m.id);
                        else next.delete(m.id);
                        setPicked(next);
                      }}
                    />
                    {m.seatNo ?? "-"}번 {m.name}
                  </label>
                ))}
              </div>
            ) : null}
            <p className="text-sm">
              대상 {targets.total}명 중 번호가 있는 <span className="font-semibold">{targets.reachable}명</span>에게 발송됩니다.
            </p>
          </CardContent>
        </Card>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        {state.ok ? (
          <p className="text-sm text-emerald-700">
            발송 요청 {state.queued}건 (번호 없음 {state.skipped}건 건너뜀) · 성공 {state.sent}건 · 실패 {state.failed}건
          </p>
        ) : null}
        <Button type="submit" disabled={pending || targets.reachable === 0}>
          {pending ? "발송 중…" : `${targets.reachable}명에게 발송`}
        </Button>
      </div>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>미리보기</CardTitle>
          <CardDescription>발송 채널: {providerName === "mock" ? "테스트(실제 발송 없음)" : providerName}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-[#FEE500]/20 px-3.5 py-3 text-sm leading-relaxed whitespace-pre-wrap">{preview}</div>
        </CardContent>
      </Card>
    </form>
  );
}
