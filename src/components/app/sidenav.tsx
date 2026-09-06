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
      <div className="flex-1 space-y-6 px-3 py-5">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="mb-1 px-3 text-[11px] text-sidebar-foreground/40">{g.label}</p>
            <ul>
              {g.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-3 py-[7px] text-[13.5px] transition-colors",
                        active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className={cn("size-4", active ? "text-sidebar-primary" : "text-sidebar-foreground/55")} aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {item.href === "/notifications" && unread > 0 ? <span className="text-[11px] text-sidebar-primary">{unread}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-sidebar-border px-6 py-3 text-[11px] text-sidebar-foreground/35">프로젝트12 통합관리</div>
    </nav>
  );
}

export function MobileNav({ items, unread }: { items: NavItem[]; unread: number }) {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex h-14 flex-col items-center justify-center gap-1 text-[11px]", active ? "font-medium text-foreground" : "text-muted-foreground")}
              >
                <Icon className="size-5" aria-hidden />
                {item.label}
                {item.href === "/notifications" && unread > 0 ? <span className="absolute top-2.5 right-[calc(50%-14px)] size-1.5 rounded-full bg-brand" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
