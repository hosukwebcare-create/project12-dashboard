/**
 * 대시보드 "오늘 챙길 것". 여러 화면의 수치를 모아 급한 순서로 줄 세운다.
 * 순수 함수 — 시각과 데이터를 받아 목록만 돌려준다.
 */

export type AttentionLevel = "urgent" | "warning" | "info";

export type AttentionItem = {
  key: string;
  level: AttentionLevel;
  title: string;
  detail?: string;
  href: string;
  /** 눌렀을 때 가는 화면 이름. 화살표 대신 어디로 가는지 글자로 보인다 */
  target: string;
};

export type AttentionInput = {
  /** "HH:MM" 현재 시각. 라운딩 지연 판단에 쓴다 */
  nowTime: string;
  /** 오늘 완료한 회차 번호. 하루 표에서는 아무 회차나 먼저 완료할 수 있어 개수가 아니라 번호로 본다 */
  completedRounds: number[];
  roundsPerDay: number;
  roundSchedule: string[];
  missingWeekly: number;
  weekStart: string;
  expiring: { name: string; seatNo: number | null; daysLeft: number }[];
  openIssues: { severity: string }[];
  money: { pending: number; amount: number; unpriced: number } | null;
  unreadNotes: number;
  /** 아직 아무도 안 한 '해 주세요' */
  openRequests?: number;
  todayAppointments: { startTime: string; displayName: string }[];
};

const ORDER: Record<AttentionLevel, number> = { urgent: 0, warning: 1, info: 2 };

export function buildAttention(i: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];

  // 라운딩: 시간표에서 시작 시각이 지났는데 아직 완료하지 않은 회차
  const done = new Set(i.completedRounds);
  const overdue = i.roundSchedule
    .slice(0, i.roundsPerDay)
    .map((t, k) => (t && t <= i.nowTime && !done.has(k + 1) ? k + 1 : null))
    .filter((n): n is number => n !== null);
  if (overdue.length >= 2) {
    const names = overdue.slice(0, 4).map((n) => `R${n}`).join("·") + (overdue.length > 4 ? ` 외 ${overdue.length - 4}회차` : "");
    out.push({ key: "rounds", level: "urgent", title: `라운딩이 ${overdue.length}회차 밀려 있습니다`, detail: `${names} 미완료 · 시간표 기준`, href: "/rounding", target: "라운딩" });
  } else if (overdue.length === 1) {
    out.push({ key: "rounds", level: "warning", title: `R${overdue[0]} 시작 시간이 지났습니다`, detail: `${i.completedRounds.length}/${i.roundsPerDay} 회차 완료`, href: "/rounding", target: "라운딩" });
  }

  const high = i.openIssues.filter((x) => x.severity === "high").length;
  if (high > 0) {
    out.push({ key: "issues-high", level: "urgent", title: `긴급 이슈 ${high}건이 미해결입니다`, detail: `미해결 전체 ${i.openIssues.length}건`, href: "/issues", target: "이슈함" });
  } else if (i.openIssues.length > 0) {
    out.push({ key: "issues", level: "info", title: `미해결 이슈 ${i.openIssues.length}건`, href: "/issues", target: "이슈함" });
  }

  const soon = i.expiring.filter((e) => e.daysLeft <= 3);
  const names = (list: typeof i.expiring) => list.slice(0, 3).map((e) => (e.seatNo ? `${e.seatNo}번 ${e.name}` : e.name)).join(", ") + (list.length > 3 ? ` 외 ${list.length - 3}명` : "");
  if (soon.length > 0) {
    out.push({ key: "expiring-soon", level: "urgent", title: `등록 만료 ${soon.length}명 · 3일 안`, detail: names(soon), href: "/members?tab=enrolled", target: "회원" });
  } else if (i.expiring.length > 0) {
    out.push({ key: "expiring", level: "warning", title: `등록 만료 임박 ${i.expiring.length}명 · 7일 안`, detail: names(i.expiring), href: "/members?tab=enrolled", target: "회원" });
  }

  if (i.missingWeekly > 0) {
    out.push({ key: "counsel", level: "warning", title: `상담일지 미작성 ${i.missingWeekly}명`, detail: "이번 주 원장 상담", href: `/counsel/weekly?week=${i.weekStart}`, target: "상담일지" });
  }

  if (i.money) {
    if (i.money.unpriced > 0) {
      out.push({ key: "unpriced", level: "warning", title: `금액 미정 ${i.money.unpriced}건`, detail: "좌석 등급이나 요금표가 없어 청구액을 못 매겼습니다", href: "/payments", target: "결제 대상" });
    }
    if (i.money.pending > 0) {
      out.push({ key: "money", level: "info", title: `받을 돈 ${i.money.pending}건 · ${i.money.amount.toLocaleString("ko-KR")}원`, href: "/payments", target: "결제 대상" });
    }
  }

  if (i.todayAppointments.length > 0) {
    const first = [...i.todayAppointments].sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
    out.push({ key: "appointments", level: "info", title: `오늘 상담 ${i.todayAppointments.length}건`, detail: `${first.startTime} ${first.displayName}부터`, href: "/counsel/schedule", target: "일정표" });
  }

  if (i.openRequests && i.openRequests > 0) {
    out.push({ key: "requests", level: "warning", title: `해 주세요 ${i.openRequests}건이 남아 있습니다`, detail: "다음 사람에게 맡긴 일", href: "/handover#requests", target: "인수인계" });
  }

  if (i.unreadNotes > 0) {
    out.push({ key: "handover", level: "info", title: `인수인계 안 읽은 글 ${i.unreadNotes}건`, href: "/handover", target: "인수인계" });
  }

  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}
