import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, inRls, withRls } from "@/db/client";
import { auditLogs, issues, members, penaltyRules } from "@/db/schema";
import { listMembers } from "@/modules/members/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

/**
 * Postgres RLS 는 superuser 와 (FORCE 없이는) 테이블 소유자에게 적용되지 않는다.
 * 이 테스트는 scripts/db-local-app-role.sql 로 만든 비superuser 역할로 접속해야 의미가 있다.
 */
describe("Postgres RLS · 지점 격리 이중 방어", () => {
  beforeAll(async () => {
    const [row] = await db.execute<{ usesuper: boolean; user: string }>(sql`select usesuper, current_user as "user" from pg_user where usename = current_user`);
    if (row.usesuper) {
      throw new Error(`테스트 DB 접속 역할(${row.user})이 superuser 라 RLS 가 적용되지 않습니다. psql byeolha_test -f scripts/db-local-app-role.sql 뒤 DATABASE_URL_TEST 를 byeolha_app 으로 바꾸세요`);
    }
  });
  beforeEach(resetDb);

  it("컨텍스트 밖(배치·로그인)에서는 정책이 통과한다", async () => {
    const t = await seedTwoBranches();
    await db.insert(members).values([
      { branchId: t.b1.id, name: "회원1" },
      { branchId: t.b2.id, name: "회원2" },
    ]);
    expect(inRls()).toBe(false);
    expect((await db.select().from(members)).length).toBe(2);
  });

  it("지점 컨텍스트 안에서는 where 절이 없어도 다른 지점 행이 보이지 않는다", async () => {
    const t = await seedTwoBranches();
    await db.insert(members).values([
      { branchId: t.b1.id, name: "회원1" },
      { branchId: t.b2.id, name: "회원2" },
    ]);
    const scope1 = { branchId: t.b1.id, userId: t.users.mgr1.id, isHq: false };
    const names = await withRls(scope1, async () => {
      expect(inRls()).toBe(true);
      return (await db.select({ name: members.name }).from(members)).map((r) => r.name);
    });
    expect(names).toEqual(["회원1"]);
    // 저장소 함수도 같은 결과
    expect((await withRls(scope1, () => listMembers(t.mgrCtx1))).map((m) => m.name)).toEqual(["회원1"]);
  });

  it("다른 지점으로의 insert·update 는 DB 가 막는다", async () => {
    const t = await seedTwoBranches();
    const [other] = await db.insert(members).values({ branchId: t.b2.id, name: "회원2" }).returning();
    const scope1 = { branchId: t.b1.id, userId: t.users.mgr1.id, isHq: false };
    await expect(withRls(scope1, () => db.insert(issues).values({ branchId: t.b2.id, title: "몰래", reportedBy: t.users.mgr1.id }))).rejects.toSatisfy(
      (e: unknown) => /row-level security/.test(String((e as { cause?: Error }).cause?.message ?? (e as Error).message)),
    );
    // where 로 다른 지점 행을 지정해도 보이지 않으므로 0건 갱신
    const updated = await withRls(scope1, () => db.update(members).set({ name: "변조" }).where(sql`${members.id} = ${other.id}`).returning());
    expect(updated).toHaveLength(0);
    const [fresh] = await db.select().from(members).where(sql`${members.id} = ${other.id}`);
    expect(fresh.name).toBe("회원2");
  });

  it("본사 관리자 컨텍스트는 전 지점을 보고, 본사 기본값(branch_id null) 행은 모두에게 보인다", async () => {
    const t = await seedTwoBranches();
    await db.insert(members).values([
      { branchId: t.b1.id, name: "회원1" },
      { branchId: t.b2.id, name: "회원2" },
    ]);
    await db.insert(penaltyRules).values({ branchId: t.b2.id, name: "지점2 규칙", points: 1 });
    const hq = await withRls({ branchId: t.b1.id, userId: t.users.hq.id, isHq: true }, () => db.select().from(members));
    expect(hq).toHaveLength(2);
    const rules = await withRls({ branchId: t.b1.id, userId: t.users.mgr1.id, isHq: false }, () => db.select({ name: penaltyRules.name }).from(penaltyRules));
    expect(rules.map((r) => r.name).sort()).toEqual(["이동금지 위반", "졸음", "지각"].sort());
  });

  it("트랜잭션은 중첩되지 않고, 안에서 쓴 감사 로그는 커밋된다", async () => {
    const t = await seedTwoBranches();
    const scope1 = { branchId: t.b1.id, userId: t.users.mgr1.id, isHq: false };
    await withRls(scope1, async () => {
      await withRls(scope1, async () => {
        await db.insert(auditLogs).values({ actorId: t.users.mgr1.id, branchId: t.b1.id, entity: "x", entityId: t.b1.id, action: "create" });
      });
    });
    expect(await db.select().from(auditLogs)).toHaveLength(1);
  });

  it("Next 의 redirect 예외는 롤백하지 않고 커밋한 뒤 다시 던진다", async () => {
    const t = await seedTwoBranches();
    const scope1 = { branchId: t.b1.id, userId: t.users.mgr1.id, isHq: false };
    const nav = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/issues/1;307;" });
    await expect(
      withRls(scope1, async () => {
        await db.insert(members).values({ branchId: t.b1.id, name: "저장됨" });
        throw nav;
      }),
    ).rejects.toBe(nav);
    expect((await db.select().from(members)).map((m) => m.name)).toEqual(["저장됨"]);
    // 일반 오류는 롤백
    await expect(
      withRls(scope1, async () => {
        await db.insert(members).values({ branchId: t.b1.id, name: "롤백" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.select().from(members)).toHaveLength(1);
  });
});
