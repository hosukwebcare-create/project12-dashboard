import { Bell, LogOut } from "lucide-react";
import Link from "next/link";
import { logout, switchBranch } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL, type Ctx } from "@/lib/auth/ctx";
import { BranchSwitcher } from "./branch-switcher";
import { BrandMark } from "./brand-mark";

export function TopBar({ ctx, unread }: { ctx: Ctx; unread: number }) {
  const initial = ctx.userName.trim().slice(0, 1) || "?";
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur md:px-5">
      <Link href={ctx.role === "assistant" ? "/rounding" : "/"} className="flex items-center gap-2" aria-label="홈">
        <BrandMark className="size-7" />
        <span className="text-[17px] font-bold tracking-tight">별하</span>
      </Link>
      <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
      <div className="flex items-center gap-2">
        <BranchSwitcher current={ctx.branchId} options={ctx.memberships} action={switchBranch} />
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <Button asChild variant="ghost" size="icon" aria-label={`알림 ${unread}건`} className="rounded-full">
          <Link href="/notifications" className="relative">
            <Bell className="size-4" />
            {unread > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] leading-4 font-semibold text-brand-foreground">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Link>
        </Button>
        <span className="flex items-center gap-2 pl-1 text-sm">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground" aria-hidden>
            {initial}
          </span>
          <span>
            {ctx.userName} <span className="hidden text-muted-foreground sm:inline">· {ROLE_LABEL[ctx.role]}</span>
          </span>
        </span>
        <form action={logout}>
          <Button type="submit" variant="ghost" size="icon" aria-label="로그아웃" className="rounded-full text-muted-foreground">
            <LogOut className="size-4" />
          </Button>
        </form>
      </div>
    </header>
  );
}
