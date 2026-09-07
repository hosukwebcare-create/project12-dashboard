import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditLogs, members } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  assignSeat,
  changeStatus,
  createMember,
  getMember,
  listMembers,
  listSeatsWithOccupant,
  updateMember,
} from "@/modules/members/repo";
import { eq } from "drizzle-orm";
import { buildCtx } from "@/lib/auth/ctx";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

const baseInput = {
  name: "홍길동",
  phone: "010-0000-0001",
  memberKind: "student" as const,
  status: "enrolled" as const,
  focusCare: false,
  guardian: { name: "홍보호자", relation: "모", phone: "010-0000-0002" },
  enrollment: { startDate: "2026-09-01", endDate: "2026-09-30", planType: "regular" as const },
};

describe("회원 저장소 · 지점 격리", () => {
  beforeEach(resetDb);

  it("목록은 활성 지점의 회원만 포함한다", async () => {
    const t = await seedTwoBranches();
    await createMember(t.mgrCtx1, { ...baseInput, name: "지점1회원", seatId: t.seats1[0].id });
    await createMember(t.mgrCtx2, { ...baseInput, name: "지점2회원", seatId: t.seats2[0].id });
    const list1 = await listMembers(t.mgrCtx1);
    expect(list1.map((m) => m.name)).toEqual(["지점1회원"]);
    expect((await listMembers(t.mgrCtx2)).map((m) => m.name)).toEqual(["지점2회원"]);
  });

  it("타 지점 회원 id로 상세를 조회하면 NotFoundError", async () => {
    const t = await seedTwoBranches();
    const id = await createMember(t.mgrCtx2, { ...baseInput, seatId: t.seats2[0].id });
    await expect(getMember(t.mgrCtx1, id)).rejects.toThrow(NotFoundError);
    await expect(updateMember(t.mgrCtx1, id, { ...baseInput, name: "변경" })).rejects.toThrow(NotFoundError);
  });

  it("조교 목록에는 연락처·학부모·주소가 없다", async () => {
    const t = await seedTwoBranches();
    await createMember(t.mgrCtx1, { ...baseInput, seatId: t.seats1[0].id });
    const [row] = await listMembers(t.asstCtx1);
    expect(row.name).toBe("홍길동");
    expect(row.seatNo).toBe(1);
    expect("phone" in row).toBe(false);
    expect("address" in row).toBe(false);
    const detail = await getMember(t.asstCtx1, row.id);
    expect(detail.phone).toBeNull();
    expect(detail.guardians).toEqual([]);
    expect(detail.address).toBeNull();
  });

  it("조교는 회원을 만들 수 없다", async () => {
    const t = await seedTwoBranches();
    await expect(createMember(t.asstCtx1, baseInput)).rejects.toThrow(ForbiddenError);
  });
});

describe("회원 저장소 · 상태와 좌석", () => {
  beforeEach(resetDb);

  it("등록 시 학부모와 등록기간이 함께 저장되고 감사 로그가 남는다", async () => {
    const t = await seedTwoBranches();
    const id = await createMember(t.mgrCtx1, { ...baseInput, seatId: t.seats1[1].id });
    const d = await getMember(t.mgrCtx1, id);
    expect(d.seatNo).toBe(2);
    expect(d.guardians[0]).toMatchObject({ name: "홍보호자", phone: "010-0000-0002" });
    expect(d.enrollments[0]).toMatchObject({ startDate: "2026-09-01", endDate: "2026-09-30" });
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, id));
    expect(logs.some((l) => l.action === "create")).toBe(true);
  });

  it("퇴원 처리하면 좌석이 비고 status 감사 로그가 남는다", async () => {
    const t = await seedTwoBranches();
    const id = await createMember(t.mgrCtx1, { ...baseInput, seatId: t.seats1[0].id });
    await changeStatus(t.mgrCtx1, id, "withdrawn");
    const [row] = await db.select().from(members).where(eq(members.id, id));
    expect(row.status).toBe("withdrawn");
    expect(row.seatId).toBeNull();
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, id));
    expect(logs.find((l) => l.action === "status")?.after).toMatchObject({ status: "withdrawn" });
    // 좌석이 비었으니 다른 회원이 앉을 수 있다
    await expect(createMember(t.mgrCtx1, { ...baseInput, name: "다음회원", seatId: t.seats1[0].id })).resolves.toBeDefined();
  });

  it("이미 사용 중인 좌석에 배정하면 오류 메시지를 낸다", async () => {
    const t = await seedTwoBranches();
    await createMember(t.mgrCtx1, { ...baseInput, seatId: t.seats1[0].id });
    const other = await createMember(t.mgrCtx1, { ...baseInput, name: "둘째", seatId: t.seats1[1].id });
    await expect(assignSeat(t.mgrCtx1, other, t.seats1[0].id)).rejects.toThrow(/이미 사용 중/);
  });

  it("타 지점 좌석에는 배정할 수 없다", async () => {
    const t = await seedTwoBranches();
    const id = await createMember(t.mgrCtx1, baseInput);
    await expect(assignSeat(t.mgrCtx1, id, t.seats2[0].id)).rejects.toThrow(NotFoundError);
  });

  it("좌석 현황은 점유자 이름을 함께 준다", async () => {
    const t = await seedTwoBranches();
    await createMember(t.mgrCtx1, { ...baseInput, seatId: t.seats1[2].id });
    const rows = await listSeatsWithOccupant(t.mgrCtx1);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toMatchObject({ seatNo: 3, memberName: "홍길동" });
    expect(rows[0].memberName).toBeNull();
  });

  it("목록 필터: 상태·집중관리·검색", async () => {
    const t = await seedTwoBranches();
    await createMember(t.mgrCtx1, { ...baseInput, name: "김집중", focusCare: true, seatId: t.seats1[0].id });
    await createMember(t.mgrCtx1, { ...baseInput, name: "이상담", status: "prospect", seatId: null });
    expect((await listMembers(t.mgrCtx1, { focusCare: true })).map((m) => m.name)).toEqual(["김집중"]);
    expect((await listMembers(t.mgrCtx1, { status: "prospect" })).map((m) => m.name)).toEqual(["이상담"]);
    expect((await listMembers(t.mgrCtx1, { q: "상담" })).map((m) => m.name)).toEqual(["이상담"]);
  });
});

describe("회원 지점 이동", () => {
  beforeEach(resetDb);

  it("본사 관리자만 옮길 수 있고, 사람 기록은 따라가고 운영 기록은 남는다", async () => {
    const t = await seedTwoBranches();
    const { transferMember, transferTargets, getMember } = await import("@/modules/members/repo");
    const { upsertLog } = await import("@/modules/counsel/repo");
    const { startSession, upsertCheck } = await import("@/modules/rounding/repo");
    const s = await import("@/db/schema");

    const m = await createMember(t.mgrCtx1, { name: "이동해", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false });
    // 사람 기록(상담일지)과 운영 기록(라운딩 체크)을 하나씩 만든다
    await upsertLog(t.mgrCtx1, { memberId: m, logType: "weekly", periodDate: "2026-09-07", field: "issue", text: "지난 지점에서 쓴 상담" });
    const sid = await startSession(t.asstCtx1, "2026-09-07");
    await upsertCheck(t.asstCtx1, { memberId: m, date: "2026-09-07", itemKey: "round", roundNo: 1, sessionId: sid, grade: "b" });

    await expect(transferMember(t.mgrCtx1, m, t.b2.id)).rejects.toThrow(ForbiddenError);
    expect((await transferTargets(t.hqCtx1)).map((b) => b.name)).toEqual(["지점2"]);
    await transferMember(t.hqCtx1, m, t.b2.id);

    const [row] = await db.select().from(s.members).where(eq(s.members.id, m));
    expect(row.branchId).toBe(t.b2.id);
    expect(row.seatId).toBeNull(); // 좌석은 비우고 받는 지점에서 배정

    const [log] = await db.select().from(s.counselLogs).where(eq(s.counselLogs.memberId, m));
    expect(log.branchId).toBe(t.b2.id); // 상담일지는 따라간다

    const [chk] = await db.select().from(s.checks).where(eq(s.checks.memberId, m));
    expect(chk.branchId).toBe(t.b1.id); // 라운딩 체크는 남는다

    // 받는 지점에서 보이고, 보낸 지점에서는 안 보인다
    const hqAtB2 = (await buildCtx(t.users.hq.id, t.b2.id))!;
    expect((await getMember(hqAtB2, m)).name).toBe("이동해");
    await expect(getMember(t.mgrCtx1, m)).rejects.toThrow(NotFoundError);
  });

  it("같은 지점이나 없는 지점으로는 못 옮긴다", async () => {
    const t = await seedTwoBranches();
    const { transferMember } = await import("@/modules/members/repo");
    const m = await createMember(t.mgrCtx1, { name: "이동해", status: "enrolled", memberKind: "student", focusCare: false });
    await expect(transferMember(t.hqCtx1, m, t.b1.id)).rejects.toThrow(/이미 이 지점/);
    await expect(transferMember(t.hqCtx1, m, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(NotFoundError);
  });
});
