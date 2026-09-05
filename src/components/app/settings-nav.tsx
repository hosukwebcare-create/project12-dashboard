"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS: { href: string; label: string; hqOnly?: boolean }[] = [
  { href: "/settings/branch", label: "지점·현황판" },
  { href: "/settings/branches", label: "지점 관리", hqOnly: true },
  { href: "/settings/users", label: "사용자" },
  { href: "/settings/seats", label: "좌석" },
  { href: "/settings/penalty-rules", label: "벌점 규칙" },
  { href: "/settings/board-items", label: "현황판 항목" },
  { href: "/settings/custom-fields", label: "커스텀 필드", hqOnly: true },
  { href: "/settings/alimtalk-templates", label: "알림톡 템플릿", hqOnly: true },
  { href: "/settings/webhooks", label: "메신저 연동" },
  { href: "/settings/audit", label: "감사 로그" },
];

export function SettingsNav({ isHq }: { isHq: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="mb-4 flex flex-wrap gap-2">
      {ITEMS.filter((i) => !i.hqOnly || isHq).map((i) => (
        <Link key={i.href} href={i.href} className={cn("rounded-full border px-3 py-1 text-sm", pathname === i.href ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
