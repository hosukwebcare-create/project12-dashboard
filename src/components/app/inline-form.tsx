"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-utils";
import { cn } from "@/lib/utils";

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  submitLabel?: string;
  className?: string;
  children: React.ReactNode;
};

/** 서버 액션의 오류·성공 상태를 보여주는 가벼운 폼 래퍼. 필드는 서버 컴포넌트에서 children으로 넘긴다. */
export function InlineForm({ action, submitLabel = "저장", className, children }: Props) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const router = useRouter();
  useEffect(() => {
    if (state.ok && !state.error) router.refresh();
  }, [state, router]);
  return (
    <form action={formAction} className={cn("flex flex-wrap items-end gap-2", className)}>
      {children}
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "저장 중…" : submitLabel}
      </Button>
      {state.error ? <span className="basis-full text-xs text-destructive">{state.error}</span> : null}
      {state.ok && !state.error ? <span className="basis-full text-xs text-emerald-700">저장됨</span> : null}
    </form>
  );
}
