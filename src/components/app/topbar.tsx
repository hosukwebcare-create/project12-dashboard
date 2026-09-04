import { Bell, LogOut } from "lucide-react";
import Link from "next/link";
import { logout, switchBranch } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL, type Ctx } from "@/lib/auth/ctx";
import { BranchSwitcher } from "./branch-switcher";

export function TopBar({ ctx, unread }: { ctx: Ctx; unread: number }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background px-4">
      <Link href={ctx.role === "assistant" ? "/rounding" : "/"} className="text-lg font-bold tracking-tight">
        별하
      </Link>
      <div className="ml-2 flex items-center gap-2">
        <BranchSwitcher current={ctx.branchId} options={ctx.memberships} action={switchBranch} />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button asChild variant="ghost" size="icon" aria-label={`알림 ${unread}건`}>
          <Link href="/notifications" className="relative">
            <Bell className="size-4" />
            {unread > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-4 text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Link>
        </Button>
        <span className="text-sm">
          {ctx.userName} <span className="hidden text-muted-foreground sm:inline">· {ROLE_LABEL[ctx.role]}</span>
        </span>
        <form action={logout}>
          <Button type="submit" variant="ghost" size="icon" aria-label="로그아웃">
            <LogOut className="size-4" />
          </Button>
        </form>
      </div>
    </header>
  );
}
