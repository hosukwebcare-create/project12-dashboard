"use client";

import { PillNav } from "./pill-nav";

const ITEMS: { href: string; label: string; hqOnly?: boolean }[] = [
  { href: "/settings/branch", label: "지점·현황판" },
  { href: "/settings/branches", label: "지점 관리", hqOnly: true },
  { href: "/settings/users", label: "사용자" },
  { href: "/settings/seats", label: "좌석" },
  { href: "/settings/fees", label: "요금표" },
  { href: "/settings/penalty-rules", label: "벌점 규칙" },
  { href: "/settings/board-items", label: "현황판 항목" },
  { href: "/settings/custom-fields", label: "커스텀 필드", hqOnly: true },
  { href: "/settings/alimtalk-templates", label: "알림톡 템플릿", hqOnly: true },
  { href: "/settings/webhooks", label: "메신저 연동" },
  { href: "/settings/audit", label: "감사 로그" },
  { href: "/settings/security", label: "보안 기록", hqOnly: true },
];

export function SettingsNav({ isHq }: { isHq: boolean }) {
  return <PillNav items={ITEMS.filter((i) => !i.hqOnly || isHq)} />;
}
