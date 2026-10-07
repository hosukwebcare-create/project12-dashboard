"use client";

import { useActionState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/lib/action-utils";

type Props = {
  branchCode: string;
  hasToken: boolean;
  save: (prev: ActionState, fd: FormData) => Promise<ActionState>;
};

/**
 * 잔디 → 플랫폼 연동 설정. 잔디 커넥트의 아웃고잉 웹훅에 등록할 주소를 보여 주고, 잔디가 만들어 준 토큰을 받아 둔다.
 * 토큰은 해시로만 저장되므로 한 번 넣으면 다시 보이지 않는다.
 */
export function JandiPanel({ branchCode, hasToken, save }: Props) {
  const [state, action, pending] = useActionState<ActionState, FormData>(save, {});
  // 서버에서는 주소를 모르므로 경로만, 브라우저에서는 사이트 주소까지 붙여 보여 준다
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const url = `${origin}/api/integrations/jandi/${branchCode}`;
  return (
    <div className="space-y-3 text-sm">
      <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>
          잔디 PC 화면에서 대화방 › 잔디 커넥트 › <b>Webhook 발신 (Outgoing Webhook)</b> › 연동 항목 추가
        </li>
        <li>
          시작 키워드에 <code className="rounded bg-muted px-1">해주세요</code>, 웹훅 URL 에 아래 주소를 넣습니다
        </li>
        <li>잔디가 보여 주는 <b>토큰</b>을 아래 칸에 붙여 넣고 저장합니다</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
        <code className="min-w-0 flex-1 break-all text-xs">{url}</code>
        <Button type="button" size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(url)}>
          복사
        </Button>
      </div>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1 space-y-1">
          <Label htmlFor="jandi-token">잔디 토큰 {hasToken ? <span className="text-xs font-normal text-muted-foreground">(저장됨 · 새로 넣으면 바뀝니다)</span> : null}</Label>
          <Input id="jandi-token" name="token" type="password" autoComplete="off" placeholder={hasToken ? "••••••••" : "잔디 커넥트 화면의 토큰"} />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "저장 중…" : "토큰 저장"}
        </Button>
        {hasToken ? (
          <Button type="submit" size="sm" variant="ghost" name="clear" value="1" disabled={pending}>
            연동 해제
          </Button>
        ) : null}
        {state.error ? <p className="basis-full text-xs text-destructive">{state.error}</p> : null}
        {state.ok && !state.error ? <p className="basis-full text-xs text-success">저장했습니다. 이제 잔디에서 &lsquo;/해주세요 내용&rsquo; 이라고 쓰면 여기 &lsquo;해 주세요&rsquo; 칸에 올라옵니다.</p> : null}
      </form>
      <p className="text-xs text-muted-foreground">잔디에 쓴 사람 이름이 부탁 끝에 &lsquo;— 잔디에서 ○○○&rsquo; 로 남습니다. 키워드 없는 글은 가져오지 않습니다.</p>
    </div>
  );
}
