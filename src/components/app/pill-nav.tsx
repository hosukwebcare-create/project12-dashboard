"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type PillItem = { href: string; label: string };

/** 알약형 링크 묶음. 현재 경로와 같은 항목이 활성 (active 로 직접 지정 가능) */
export function PillNav({ items, className, isActive }: { items: PillItem[]; className?: string; isActive?: (href: string) => boolean }) {
  const pathname = usePathname();
  const active = isActive ?? ((href: string) => pathname === href);
  return (
    <nav className={cn("pill-nav mb-4", className)}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="pill" data-active={active(i.href)}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
