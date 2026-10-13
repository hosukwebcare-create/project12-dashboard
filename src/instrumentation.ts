/**
 * 서버가 켜질 때 한 번 실행된다 (Next.js instrumentation). Node 런타임에서만 자동 마이그레이션과 배치 스케줄러를 켠다.
 * 실제 구현은 instrumentation-node.ts 에 있고, 엣지 번들에 node 모듈이 섞이지 않도록 동적으로 불러온다.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { autoMigrate } = await import("./instrumentation-node");
  await autoMigrate();
  const { warnIfDbRoleUnsafe } = await import("./lib/db-role");
  await warnIfDbRoleUnsafe();
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}
