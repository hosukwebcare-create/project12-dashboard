"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/lib/action-utils";
import { cn } from "@/lib/utils";
import { switchByPinAction } from "@/modules/auth/pin-actions";

export function PinSwitch({ users, currentUserId }: { users: { id: string; name: string }[]; currentUserId: string }) {
  const [selected, setSelected] = useState<string | null>(users.find((u) => u.id !== currentUserId)?.id ?? users[0]?.id ?? null);
  const [state, action, pending] = useActionState<ActionState, FormData>(switchByPinAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {users.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => setSelected(u.id)}
            className={cn(
              "h-14 rounded-xl text-base font-medium transition-colors",
              selected === u.id ? "bg-primary text-primary-foreground shadow-(--shadow-float) ring-1 ring-primary" : "bg-card ring-1 ring-border hover:bg-accent/40",
            )}
          >
            {u.name}
            {u.id === currentUserId ? <span className="block text-[10px] font-normal opacity-70">현재</span> : null}
          </button>
        ))}
      </div>
      <input type="hidden" name="userId" value={selected ?? ""} />
      <div className="space-y-1.5">
        <Label htmlFor="pin">PIN</Label>
        <Input id="pin" name="pin" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={6} className="h-12 text-center text-2xl tracking-[0.5em]" required autoFocus />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={pending || !selected}>
        {pending ? "확인 중…" : "전환"}
      </Button>
    </form>
  );
}
