"use client";

import { PillNav } from "./pill-nav";

export function SubNav({ items }: { items: { href: string; label: string }[] }) {
  return <PillNav items={items} />;
}
