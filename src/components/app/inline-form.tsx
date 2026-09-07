"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-utils";
import { cn } from "@/lib/utils";

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  submitLabel?: string;
  className?: string;
  /**
   * 폼에 id 를 주면 표의 다른 칸에 있는 입력도 `form={id}` 로 이 폼에 묶을 수 있다.
   * 표에서 한 줄이 한 폼이면서 칸마다 머리글이 따로 있어야 할 때 쓴다.
   */
  id?: string;
  children?: React.ReactNode;
};

/**
 * 서버 액션의 오류·성공 상태를 보여주는 가벼운 폼 래퍼. 필드는 서버 컴포넌트에서 children으로 넘긴다.
 * 폼 action 속성 대신 onSubmit에서 액션을 호출하는 이유: React는 action 속성으로 제출된 폼을 결과와 무관하게 초기화하므로,
 * 검증 오류가 나면 입력한 값이 모두 사라진다. 여기서는 성공했을 때만 초기화한다.
 */
export function InlineForm({ action, submitLabel = "저장", className, id, children }: Props) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && !state.error) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);
  return (
    <form
      ref={formRef}
      id={id}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className={cn("flex flex-wrap items-end gap-2", className)}
    >
      {children}
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "저장 중…" : submitLabel}
      </Button>
      {state.error ? <span className="basis-full text-xs break-keep text-destructive">{state.error}</span> : null}
      {state.ok && !state.error ? <span className="basis-full text-xs break-keep text-emerald-700">저장됨</span> : null}
    </form>
  );
}
