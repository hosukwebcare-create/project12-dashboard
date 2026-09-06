import { AsyncLocalStorage } from "node:async_hooks";
import { sql as rawSql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** 일반 DB 핸들과 트랜잭션 핸들을 모두 받는 타입 */
export type Db = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;
export type Tx = Db;

// dev 서버의 HMR로 커넥션이 누적되지 않도록 전역에 캐시
const globalForDb = globalThis as unknown as { __byeolhaSql?: ReturnType<typeof postgres> };

/**
 * 커넥션은 처음 쓰는 순간에 만든다. 모듈을 불러올 때 만들면 `next build`의 페이지 수집 단계(환경 변수 없음)에서 빌드가 깨진다.
 */
export function getSql(): ReturnType<typeof postgres> {
  if (globalForDb.__byeolhaSql) return globalForDb.__byeolhaSql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 환경 변수가 없습니다");
  const client = postgres(url, { max: 10 });
  globalForDb.__byeolhaSql = client;
  return client;
}

let baseDb: Db | undefined;
function getBase(): Db {
  if (!baseDb) baseDb = drizzle(getSql(), { schema });
  return baseDb;
}

/** 요청 단위 RLS 트랜잭션. withRls 안에서는 모든 db 접근이 이 트랜잭션을 탄다 */
const rlsStore = new AsyncLocalStorage<{ tx: Db }>();

/**
 * 모듈 어디서나 import 하는 db 핸들.
 * withRls() 안에서 호출되면 지점 컨텍스트가 설정된 트랜잭션으로, 밖에서는 풀 커넥션으로 간다.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const current = rlsStore.getStore()?.tx ?? getBase();
    const value = Reflect.get(current, prop, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
});

export type RlsScope = { branchId: string; userId: string; isHq: boolean };

function isNavigationError(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));
}

/**
 * fn 을 지점 컨텍스트가 설정된 트랜잭션 안에서 실행한다. Postgres RLS 정책이 app.branch_id 로 행을 거른다.
 * - scope 가 null 이면(비로그인·배치) 컨텍스트 없이 실행하고, 정책은 통과시킨다.
 * - 이미 RLS 트랜잭션 안이면 중첩하지 않는다.
 * - Next 의 redirect()/notFound() 는 예외로 전파되므로, 그 경우엔 롤백하지 않고 커밋한 뒤 다시 던진다.
 */
export async function withRls<T>(scope: RlsScope | null, fn: () => Promise<T>, base?: Db): Promise<T> {
  if (!scope || rlsStore.getStore()) return fn();
  let navigation: unknown = null;
  const result = await (base ?? getBase()).transaction(async (tx) => {
    await tx.execute(
      rawSql`select set_config('app.rls', 'on', true), set_config('app.branch_id', ${scope.branchId}, true), set_config('app.user_id', ${scope.userId}, true), set_config('app.is_hq', ${scope.isHq ? "true" : "false"}, true)`,
    );
    try {
      return await rlsStore.run({ tx }, fn);
    } catch (e) {
      if (isNavigationError(e)) {
        navigation = e;
        return undefined as T;
      }
      throw e;
    }
  });
  if (navigation) throw navigation;
  return result;
}

/** 현재 RLS 트랜잭션 안인지 (테스트·진단용) */
export function inRls(): boolean {
  return rlsStore.getStore() !== undefined;
}
