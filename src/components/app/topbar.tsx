import { Bell, LogOut } from "lucide-react";
import Link from "next/link";
import { logout, switchBranch } from "@/app/(auth)/login/actions";
import { ROLE_LABEL, type Ctx } from "@/lib/auth/ctx";
import { BranchSwitcher } from "./branch-switcher";

/** 상단바. 잉크색 바탕에 흰 글자 — 앱에서 유일하게 어두운 띠라 어디서든 위치를 잡아 준다 */
export function TopBar({ ctx, unread }: { ctx: Ctx; unread: number }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 bg-chrome px-4 text-chrome-foreground md:px-6">
      <Link href={ctx.role === "assistant" ? "/rounding" : "/"} className="flex items-baseline gap-2 rounded-sm" aria-label="홈">
        <span className="text-[15px] font-bold tracking-tight">Project 12</span>
        <span className="hidden text-xs text-chrome-muted sm:inline">통합관리</span>
      </Link>
      <BranchSwitcher current={ctx.branchId} options={ctx.memberships} action={switchBranch} />
      <div className="ml-auto flex items-center gap-1">
        <Link href="/notifications" aria-label={`알림 ${unread}건`} className="relative flex size-8 items-center justify-center rounded-md text-chrome-muted transition-colors hover:bg-white/10 hover:text-chrome-foreground">
          <Bell className="size-[18px]" />
          {unread > 0 ? <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary-foreground" aria-hidden /> : null}
        </Link>
        <span className="px-2 text-sm">
          {ctx.userName} <span className="hidden text-chrome-muted sm:inline">{ROLE_LABEL[ctx.role]}</span>
        </span>
        <form action={logout}>
          <button type="submit" aria-label="로그아웃" className="flex size-8 items-center justify-center rounded-md text-chrome-muted transition-colors hover:bg-white/10 hover:text-chrome-foreground">
            <LogOut className="size-[18px]" />
          </button>
        </form>
      </div>
    </header>
  );
}
