import { sql } from "drizzle-orm";
import { db } from "@/db/client";

let cached: Promise<{ safe: boolean; superuser: boolean; bypassRls: boolean }> | null = null;

/**
 * 앱이 접속한 DB 계정이 행 보안(RLS)을 지키는가. superuser 나 BYPASSRLS 계정은 지점 격리 정책을 통째로 무시한다
 * (Railway 기본 계정 postgres 가 superuser 다 — docs/07 배포 체크리스트). 계정은 실행 중에 바뀌지 않으므로 한 번만 묻는다.
 */
export function dbRoleStatus(): Promise<{ safe: boolean; superuser: boolean; bypassRls: boolean }> {
  cached ??= db
    .execute<{ rolsuper: boolean; rolbypassrls: boolean }>(sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`)
    .then(([r]) => {
      const superuser = Boolean(r?.rolsuper);
      const bypassRls = Boolean(r?.rolbypassrls);
      return { safe: !superuser && !bypassRls, superuser, bypassRls };
    })
    .catch((e) => {
      cached = null; // DB 가 잠깐 안 될 때 실패를 굳히지 않는다
      throw e;
    });
  return cached;
}

/** 서버 기동 때 한 번: 안전하지 않으면 로그에 크게 남긴다 */
export async function warnIfDbRoleUnsafe(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const s = await dbRoleStatus();
    if (!s.safe) {
      console.error(
        `[security] DB 접속 계정이 ${s.superuser ? "superuser" : "BYPASSRLS"} 라서 지점 격리(RLS)가 꺼진 것과 같습니다. scripts/db-app-role-prod.sql 로 앱 계정을 만들어 DATABASE_URL 을 바꾸세요 (docs/07 배포 체크리스트)`,
      );
    }
  } catch (e) {
    console.error("[security] DB 계정 점검 실패", e instanceof Error ? e.message : e);
  }
}
