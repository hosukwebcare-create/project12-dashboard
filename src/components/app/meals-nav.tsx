"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function MealsNav({ canManage }: { canManage: boolean }) {
  const pathname = usePathname();
  const items = [
    { href: "/meals", label: "월별 신청" },
    { href: "/meals/daily", label: "일별 발주" },
    ...(canManage ? [{ href: "/meals/settlement", label: "월 정산" }, { href: "/meals/settings", label: "설정" }] : []),
  ];
  return (
    <nav className="mb-4 flex flex-wrap gap-2">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={cn("rounded-full border px-3 py-1 text-sm", pathname === i.href ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
