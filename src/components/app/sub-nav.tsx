"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SubNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
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
