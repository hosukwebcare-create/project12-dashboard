import { purgeSecurityEvents } from "./events";
import { purgeOldSessions } from "./sessions";

/** 보안 기록 보관 기간(일). 시스템 설계서 9장: 접근 로그 1년 */
export const SECURITY_EVENT_RETENTION_DAYS = 365;

/** 보관 배치에서 함께 돈다: 1년 지난 보안 기록, 끝난 지 30일 지난 세션 */
export async function purgeSecurityRecords(now = new Date()): Promise<{ securityEvents: number; sessions: number }> {
  const [securityEvents, sessions] = await Promise.all([purgeSecurityEvents(SECURITY_EVENT_RETENTION_DAYS, now), purgeOldSessions(now)]);
  return { securityEvents, sessions };
}
