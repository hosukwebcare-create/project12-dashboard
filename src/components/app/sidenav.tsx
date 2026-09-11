"use client";

import { AlertTriangle, Bell, BookOpen, CheckSquare, ClipboardList, Clock, CreditCard, Footprints, Home, NotebookPen, PanelLeftClose, PanelLeftOpen, Send, Settings, UtensilsCrossed, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
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
  handover: NotebookPen,
  won: CreditCard,
} as const;

/** 사이드바 그룹. 순서는 nav-items 의 순서를 따르되 그룹 머리글로 묶는다 */
const GROUPS: { label: string; hrefs: string[] }[] = [
  { label: "운영", hrefs: ["/", "/members", "/counsel/weekly", "/mock-exams"] },
  { label: "현장", hrefs: ["/rounding", "/daily-checks", "/meals", "/worklog"] },
  { label: "정산", hrefs: ["/payments"] },
  { label: "소통", hrefs: ["/handover", "/issues", "/alimtalk", "/notifications"] },
  { label: "관리", hrefs: ["/settings/branch"] },
];

/**
 * 접힘 상태는 브라우저에만 기억한다. 1280px 노트북에서 표가 넓은 화면(결제·회원)을 볼 때
 * 170px 을 돌려주기 위한 것이라 계정 설정까지 갈 일은 아니다.
 * 서버 렌더는 항상 펼친 상태 — 접어둔 사람은 첫 그림에서 잠깐 펼쳐졌다 접힌다.
 */
const RAIL_KEY = "byeolha.sidenav.rail";
const railListeners = new Set<() => void>();
function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}
function writeRail(v: boolean) {
  try {
    localStorage.setItem(RAIL_KEY, v ? "1" : "0");
  } catch {
    /* 저장소 사용 불가 시 이번 화면에서만 유지 */
  }
  railListeners.forEach((cb) => cb());
}
function subscribeRail(cb: () => void) {
  railListeners.add(cb);
  return () => {
    railListeners.delete(cb);
  };
}
function useRail() {
  const rail = useSyncExternalStore(
    subscribeRail,
    readRail,
    useCallback(() => false, []),
  );
  return [rail, writeRail] as const;
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  const base = href.split("/").slice(0, 2).join("/");
  return pathname.startsWith(base);
}

export function SideNav({ items, unread }: { items: NavItem[]; unread: number }) {
  const pathname = usePathname();
  const [rail, setRail] = useRail();
  const groups = GROUPS.map((g) => ({ ...g, items: g.hrefs.map((h) => items.find((i) => i.href === h)).filter((x): x is NavItem => Boolean(x)) })).filter((g) => g.items.length);
  return (
    <nav
      data-rail={rail ? "true" : undefined}
      className={cn("hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex", rail ? "w-14" : "w-56")}
    >
      <div className={cn("flex-1 space-y-6 py-5", rail ? "px-2" : "px-3")}>
        {groups.map((g) => (
          <div key={g.label}>
            {/* 접혔을 때는 그룹 이름 대신 얇은 선으로 묶음을 나눈다 */}
            {rail ? <div className="mx-2 mb-2 border-t border-sidebar-border first:hidden" aria-hidden /> : <p className="mb-1 px-3 text-[11px] font-medium tracking-wide text-muted-foreground">{g.label}</p>}
            <ul>
              {g.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(pathname, item.href);
                const badge = item.href === "/notifications" && unread > 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      aria-label={rail ? item.label : undefined}
                      title={rail ? item.label : undefined}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-md text-[13.5px] transition-colors",
                        rail ? "h-10 justify-center px-0" : "px-3 py-[7px]",
                        active ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-muted",
                      )}
                    >
                      <Icon className={cn("size-4 shrink-0", active ? "text-sidebar-primary" : "text-muted-foreground")} aria-hidden />
                      {rail ? null : <span className="flex-1">{item.label}</span>}
                      {badge && !rail ? <span className="rounded-full bg-primary px-1.5 py-px text-[11px] font-semibold text-primary-foreground tabular-nums">{unread}</span> : null}
                      {badge && rail ? <span className="absolute top-2 right-2 size-1.5 rounded-full bg-primary" aria-hidden /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className={cn("flex items-center border-t border-sidebar-border py-2", rail ? "justify-center px-2" : "justify-between pr-2 pl-6")}>
        {rail ? null : <span className="text-[11px] text-muted-foreground">Project 12 통합관리</span>}
        <button
          type="button"
          onClick={() => setRail(!rail)}
          aria-label={rail ? "메뉴 펼치기" : "메뉴 접기"}
          aria-expanded={!rail}
          title={rail ? "메뉴 펼치기" : "메뉴 접기"}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {rail ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
        </button>
      </div>
    </nav>
  );
}

export function MobileNav({ items, unread }: { items: NavItem[]; unread: number }) {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex h-14 flex-col items-center justify-center gap-1 text-[11px]", active ? "font-semibold text-primary" : "text-muted-foreground")}
              >
                <Icon className="size-5" aria-hidden />
                {item.label}
                {item.href === "/notifications" && unread > 0 ? <span className="absolute top-2.5 right-[calc(50%-14px)] size-1.5 rounded-full bg-primary" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
