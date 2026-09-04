import type { Role } from "@/lib/auth/ctx";

export type NavItem = { href: string; label: string; roles: Role[]; icon: "home" | "users" | "book" | "walk" | "check" | "alert" | "bell" | "settings" | "exam" | "meal" | "clock" | "send" };

const ALL: Role[] = ["hq_admin", "branch_manager", "mentor", "assistant"];
const STAFF: Role[] = ["hq_admin", "branch_manager", "mentor"];
const MANAGERS: Role[] = ["hq_admin", "branch_manager"];

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "대시보드", roles: STAFF, icon: "home" },
  { href: "/members", label: "회원", roles: ALL, icon: "users" },
  { href: "/counsel/weekly", label: "상담일지", roles: STAFF, icon: "book" },
  { href: "/mock-exams", label: "모의고사", roles: STAFF, icon: "exam" },
  { href: "/rounding", label: "라운딩", roles: ALL, icon: "walk" },
  { href: "/daily-checks", label: "일별 체크", roles: ["hq_admin", "branch_manager", "assistant"], icon: "check" },
  { href: "/meals", label: "식사주문", roles: ["hq_admin", "branch_manager", "assistant"], icon: "meal" },
  { href: "/worklog", label: "근무", roles: ALL, icon: "clock" },
  { href: "/issues", label: "이슈함", roles: ALL, icon: "alert" },
  { href: "/alimtalk", label: "알림톡", roles: MANAGERS, icon: "send" },
  { href: "/notifications", label: "알림", roles: ALL, icon: "bell" },
  { href: "/settings/branch", label: "설정", roles: MANAGERS, icon: "settings" },
];

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((i) => i.roles.includes(role));
}

/** 모바일 하단 탭은 최대 5개 */
export function mobileNavFor(role: Role): NavItem[] {
  const items = navFor(role);
  const preferred = role === "assistant" ? ["/rounding", "/daily-checks", "/members", "/issues", "/notifications"] : ["/", "/members", "/counsel/weekly", "/rounding", "/issues"];
  return preferred.map((h) => items.find((i) => i.href === h)).filter((x): x is NavItem => Boolean(x)).slice(0, 5);
}
