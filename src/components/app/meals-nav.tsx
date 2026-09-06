"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MealsNav({ canManage }: { canManage: boolean }) {
  const pathname = usePathname();
  const items = [
    { href: "/meals", label: "월별 신청" },
    { href: "/meals/daily", label: "일별 발주" },
    ...(canManage ? [{ href: "/meals/settlement", label: "월 정산" }, { href: "/meals/settings", label: "설정" }] : []),
  ];
  return (
    <nav className="pill-nav mb-4">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="pill" data-active={pathname === i.href}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
