import { Bell, LogOut } from "lucide-react";
import Link from "next/link";
import { logout, switchBranch } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL, type Ctx } from "@/lib/auth/ctx";
import { BranchSwitcher } from "./branch-switcher";

export function TopBar({ ctx, unread }: { ctx: Ctx; unread: number }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border bg-card px-4 md:px-6">
      <Link href={ctx.role === "assistant" ? "/rounding" : "/"} className="text-[17px] font-semibold tracking-tight" aria-label="홈">
        Project 12
      </Link>
      <BranchSwitcher current={ctx.branchId} options={ctx.memberships} action={switchBranch} />
      <div className="ml-auto flex items-center gap-1">
        <Button asChild variant="ghost" size="icon" aria-label={`알림 ${unread}건`}>
          <Link href="/notifications" className="relative text-muted-foreground hover:text-foreground">
            <Bell className="size-[18px]" />
            {unread > 0 ? <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" aria-hidden /> : null}
          </Link>
        </Button>
        <span className="px-2 text-sm">
          {ctx.userName} <span className="hidden text-muted-foreground sm:inline">{ROLE_LABEL[ctx.role]}</span>
        </span>
        <form action={logout}>
          <Button type="submit" variant="ghost" size="icon" aria-label="로그아웃" className="text-muted-foreground hover:text-foreground">
            <LogOut className="size-[18px]" />
          </Button>
        </form>
      </div>
    </header>
  );
}
