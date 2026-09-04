import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 환경 변수가 없습니다");

// dev 서버의 HMR로 커넥션이 누적되지 않도록 전역에 캐시
const globalForDb = globalThis as unknown as { __byeolhaSql?: ReturnType<typeof postgres> };
export const sql = globalForDb.__byeolhaSql ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.__byeolhaSql = sql;

export const db = drizzle(sql, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
