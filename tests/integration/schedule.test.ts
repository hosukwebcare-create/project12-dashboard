import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { createMember } from "@/modules/members/repo";
import { listNotifications } from "@/modules/notifications/repo";
import { bandOf, deleteAppointment, upcomingAppointments, upsertAppointment, weekAppointments } from "@/modules/schedule/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

// 2026-09-07 은 월요일
const MON = "2026-09-07";
const WED = "2026-09-09";

describe("상담 일정", () => {
  beforeEach(resetDb);

  it("시작 시각이 화면의 어느 시간대 칸에 들어가는지", () => {
    expect(bandOf("09:00")).toBe("am");
    expect(bandOf("13:00")).toBe("pm1");
    expect(bandOf("17:00")).toBe("pm2");
    expect(bandOf("19:00")).toBe("eve");
    expect(bandOf("12:30")).toBe("etc"); // 점심 시간은 어느 칸에도 없다
    expect(bandOf("07:00")).toBe("etc");
  });

  it("신규 상담은 이름만으로, 재상담은 회원으로 잡는다", async () => {
    const t = await seedTwoBranches();
    const m = await createMember(t.mgrCtx1, { name: "고은별", status: "enrolled", memberKind: "student", focusCare: false });

    await upsertAppointment(t.mgrCtx1, { date: MON, startTime: "14:00", kind: "new", personName: "박신규", personPhone: "010-1111-2222" });
    await upsertAppointment(t.mentorCtx1, { date: WED, startTime: "19:30", kind: "member", memberId: m });

    const { days, rows } = await weekAppointments(t.mgrCtx1, MON);
    expect(days[0]).toBe(MON);
    expect(days).toHaveLength(7);
    expect(rows.map((r) => r.displayName)).toEqual(["박신규", "고은별"]);
    expect(rows[0].personPhone).toBe("010-1111-2222");
    expect(rows[1].memberId).toBe(m);
  });

  it("이름도 회원도 없으면 거절하고, 시각 형식과 앞뒤를 확인한다", async () => {
    const t = await seedTwoBranches();
    await expect(upsertAppointment(t.mgrCtx1, { date: MON, startTime: "14:00", kind: "new" })).rejects.toThrow(/회원을 고르거나 이름/);
    await expect(upsertAppointment(t.mgrCtx1, { date: MON, startTime: "2시", kind: "new", personName: "박신규" })).rejects.toThrow(/시작 시각/);
    await expect(upsertAppointment(t.mgrCtx1, { date: MON, startTime: "14:00", endTime: "13:00", kind: "new", personName: "박신규" })).rejects.toThrow(/종료 시각이/);
    await expect(upsertAppointment(t.mgrCtx1, { date: "9월7일", startTime: "14:00", kind: "new", personName: "박신규" })).rejects.toThrow(/날짜/);
  });

  it("담당을 지정하면 그 사람에게 알림이 간다", async () => {
    const t = await seedTwoBranches();
    await upsertAppointment(t.mgrCtx1, { date: MON, startTime: "14:00", kind: "new", personName: "박신규", assignedTo: t.users.mentor1.id });
    const notes = await listNotifications(t.mentorCtx1);
    expect(notes.some((n) => String((n.payload as Record<string, unknown>).title).includes("상담 일정 배정"))).toBe(true);
    // 자기가 자기에게 배정하면 알림이 없다
    await upsertAppointment(t.mgrCtx1, { date: MON, startTime: "15:00", kind: "new", personName: "김신규", assignedTo: t.users.mgr1.id });
    expect(await listNotifications(t.mgrCtx1)).toHaveLength(0);
  });

  it("다른 지점 일정은 보이지 않고, 삭제는 지점장만", async () => {
    const t = await seedTwoBranches();
    const id = await upsertAppointment(t.mgrCtx1, { date: MON, startTime: "14:00", kind: "new", personName: "박신규" });
    expect((await weekAppointments(t.mgrCtx2, MON)).rows).toHaveLength(0);

    await expect(deleteAppointment(t.mentorCtx1, id)).rejects.toThrow(ForbiddenError);
    await deleteAppointment(t.mgrCtx1, id);
    expect((await weekAppointments(t.mgrCtx1, MON)).rows).toHaveLength(0);
  });

  it("조교는 상담 일정을 볼 수 없다", async () => {
    const t = await seedTwoBranches();
    await expect(weekAppointments(t.asstCtx1, MON)).rejects.toThrow(ForbiddenError);
  });

  it("대시보드용 목록은 예정 상태의 앞으로 7일치만", async () => {
    const t = await seedTwoBranches();
    const done = await upsertAppointment(t.mgrCtx1, { date: MON, startTime: "10:00", kind: "new", personName: "지난상담" });
    await upsertAppointment(t.mgrCtx1, { id: done, date: MON, startTime: "10:00", kind: "new", personName: "지난상담", status: "done" });
    await upsertAppointment(t.mgrCtx1, { date: WED, startTime: "14:00", kind: "new", personName: "곧올사람" });
    await upsertAppointment(t.mgrCtx1, { date: "2026-10-20", startTime: "14:00", kind: "new", personName: "먼훗날" });

    const up = await upcomingAppointments(t.mgrCtx1, 7, MON);
    expect(up.map((r) => r.displayName)).toEqual(["곧올사람"]);
  });

  it("없는 일정을 고치려 하면 오류", async () => {
    const t = await seedTwoBranches();
    await expect(upsertAppointment(t.mgrCtx1, { id: "00000000-0000-0000-0000-000000000000", date: MON, startTime: "14:00", kind: "new", personName: "x" })).rejects.toThrow(NotFoundError);
  });
});
