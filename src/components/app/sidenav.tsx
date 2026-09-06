"use client";

import { AlertTriangle, Bell, BookOpen, CheckSquare, ClipboardList, Clock, Footprints, Home, Send, Settings, UtensilsCrossed, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav-items";

const ICONS = {
  home: Home,
  users: Users,
  book: BookOpen,
  walk: Footprints,
  check: CheckSquare,
  alert: AlertTriangle,
  bell: Bell,
  settings: Settings,
  exam: ClipboardList,
  meal: UtensilsCrossed,
  clock: Clock,
  send: Send,
} as const;

/** 사이드바 그룹. 순서는 nav-items 의 순서를 따르되 그룹 머리글로 묶는다 */
const GROUPS: { label: string; hrefs: string[] }[] = [
  { label: "운영", hrefs: ["/", "/members", "/counsel/weekly", "/mock-exams"] },
  { label: "현장", hrefs: ["/rounding", "/daily-checks", "/meals", "/worklog"] },
  { label: "소통", hrefs: ["/issues", "/alimtalk", "/notifications"] },
  { label: "관리", hrefs: ["/settings/branch"] },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  const base = href.split("/").slice(0, 2).join("/");
  return pathname.startsWith(base);
}

export function SideNav({ items, unread }: { items: NavItem[]; unread: number }) {
  const pathname = usePathname();
  const groups = GROUPS.map((g) => ({ ...g, items: g.hrefs.map((h) => items.find((i) => i.href === h)).filter((x): x is NavItem => Boolean(x)) })).filter((g) => g.items.length);
  return (
    <nav className="hidden w-56 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex-1 space-y-5 px-3 py-4">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-sidebar-foreground/45">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
                        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      {active ? <span className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-r bg-sidebar-primary" aria-hidden /> : null}
                      <Icon className={cn("size-4", active ? "text-sidebar-primary" : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground")} aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {item.href === "/notifications" && unread > 0 ? (
                        <span className="rounded-full bg-sidebar-primary px-1.5 text-[10px] font-semibold text-sidebar-primary-foreground">{unread}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-sidebar-border px-5 py-3 text-[11px] text-sidebar-foreground/40">별하 · 프로젝트12 통합관리</div>
    </nav>
  );
}

export function MobileNav({ items, unread }: { items: NavItem[]; unread: number }) {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/90 backdrop-blur md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}
              >
                <span className={cn("flex h-6 w-10 items-center justify-center rounded-full transition-colors", active && "bg-accent")}>
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                {item.label}
                {item.href === "/notifications" && unread > 0 ? <span className="absolute top-2 right-[calc(50%-16px)] size-2 rounded-full bg-brand" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
