import { config } from "dotenv";

config({ path: ".env.local" });

// 테스트는 항상 테스트 DB를 향한다. 개발 DB를 TRUNCATE 하는 사고를 막기 위한 안전장치.
if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST 가 .env.local 에 없습니다");
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-1234";
