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
  sessionsDone: number;
  roundsPerDay: number;
  roundSchedule: string[];
  missingWeekly: number;
  weekStart: string;
  expiring: { name: string; seatNo: number | null; daysLeft: number }[];
  openIssues: { severity: string }[];
  money: { pending: number; amount: number; unpriced: number } | null;
  unreadNotes: number;
  todayAppointments: { startTime: string; displayName: string }[];
};

const ORDER: Record<AttentionLevel, number> = { urgent: 0, warning: 1, info: 2 };

export function buildAttention(i: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];

  // 라운딩: 시간표에서 이미 지난 회차 수와 완료 수를 비교한다
  const scheduledPast = i.roundSchedule.filter((t) => t && t <= i.nowTime).length;
  const behind = Math.min(scheduledPast, i.roundsPerDay) - i.sessionsDone;
  if (behind >= 2) {
    out.push({ key: "rounds", level: "urgent", title: `라운딩이 ${behind}회차 밀려 있습니다`, detail: `${i.sessionsDone}/${scheduledPast} 회차 완료 · 시간표 기준`, href: "/rounding", target: "라운딩" });
  } else if (behind === 1) {
    out.push({ key: "rounds", level: "warning", title: `R${i.sessionsDone + 1} 시작 시간이 지났습니다`, detail: `${i.sessionsDone}/${i.roundsPerDay} 회차 완료`, href: "/rounding", target: "라운딩" });
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

  if (i.unreadNotes > 0) {
    out.push({ key: "handover", level: "info", title: `인수인계 안 읽은 글 ${i.unreadNotes}건`, href: "/handover", target: "인수인계" });
  }

  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}
