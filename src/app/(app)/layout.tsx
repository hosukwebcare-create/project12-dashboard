import { mobileNavFor, navFor } from "@/components/app/nav-items";
import { MobileNav, SideNav } from "@/components/app/sidenav";
import { TopBar } from "@/components/app/topbar";
import { getCtx } from "@/lib/auth/ctx";
import { unreadCount } from "@/modules/notifications/repo";
import { guarded } from "@/lib/page-guard";

async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await getCtx();
  const unread = await unreadCount(ctx);
  const items = navFor(ctx.role);
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar ctx={ctx} unread={unread} />
      <div className="flex flex-1">
        <SideNav items={items} unread={unread} />
        <main className="min-w-0 flex-1 p-4 pb-20 md:p-6 md:pb-6">{children}</main>
      </div>
      <MobileNav items={mobileNavFor(ctx.role)} unread={unread} />
    </div>
  );
}

export default guarded(AppLayout);
