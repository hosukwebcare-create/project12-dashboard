import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { addComment, getLog, upsertLog, weeklyGrid } from "@/modules/counsel/repo";
import { createMember } from "@/modules/members/repo";
import { listNotifications } from "@/modules/notifications/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

const WEEK = "2026-08-31";

async function seedWithMember() {
  const t = await seedTwoBranches();
  const memberId = await createMember(t.mgrCtx1, { name: "홍길동", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: true });
  const otherId = await createMember(t.mgrCtx2, { name: "타지점", status: "enrolled", seatId: t.seats2[0].id, memberKind: "student", focusCare: false });
  return { ...t, memberId, otherId };
}

describe("집중관리일지 · 작성 권한", () => {
  beforeEach(resetDb);

  it("멘토는 원장 열(issue)을, 지점장은 멘토 열(resolution)을 쓸 수 없다", async () => {
    const t = await seedWithMember();
    await expect(upsertLog(t.mentorCtx1, { memberId: t.memberId, logType: "weekly", periodDate: WEEK, field: "issue", text: "x" })).rejects.toThrow(ForbiddenError);
    await expect(upsertLog(t.mgrCtx1, { memberId: t.memberId, logType: "weekly", periodDate: WEEK, field: "resolution", text: "x" })).rejects.toThrow(ForbiddenError);
  });

  it("지점장이 이슈를 쓰고 멘토가 해결 내용을 쓰면 같은 행에 합쳐진다", async () => {
    const t = await seedWithMember();
    const id1 = await upsertLog(t.mgrCtx1, { memberId: t.memberId, logType: "weekly", periodDate: WEEK, field: "issue", text: "국어 부족" });
    const id2 = await upsertLog(t.mentorCtx1, { memberId: t.memberId, logType: "weekly", periodDate: WEEK, field: "resolution", text: "기출 과제 부여" });
    expect(id1).toBe(id2);
    const log = await getLog(t.mgrCtx1, id1);
    expect(log.issueText).toBe("국어 부족");
    expect(log.issueBy).toBe(t.users.mgr1.id);
    expect(log.resolutionText).toBe("기출 과제 부여");
    expect(log.resolutionBy).toBe(t.users.mentor1.id);
    expect(log.memberName).toBe("홍길동");
  });

  it("타 지점 회원에는 쓸 수 없고, 타 지점 로그는 볼 수 없다", async () => {
    const t = await seedWithMember();
    await expect(upsertLog(t.mgrCtx1, { memberId: t.otherId, logType: "weekly", periodDate: WEEK, field: "issue", text: "x" })).rejects.toThrow(NotFoundError);
    const id = await upsertLog(t.mgrCtx2, { memberId: t.otherId, logType: "weekly", periodDate: WEEK, field: "issue", text: "x" });
    await expect(getLog(t.mgrCtx1, id)).rejects.toThrow(NotFoundError);
  });

  it("주간 일지는 주 시작일(월요일)만 받는다", async () => {
    const t = await seedWithMember();
    await expect(upsertLog(t.mgrCtx1, { memberId: t.memberId, logType: "weekly", periodDate: "2026-09-02", field: "issue", text: "x" })).rejects.toThrow(/월요일/);
  });
});

describe("집중관리일지 · 코멘트와 알림", () => {
  beforeEach(resetDb);

  it("@이름 멘션은 그 사람에게 mention 알림 1건, 행 작성자에게는 comment 알림", async () => {
    const t = await seedWithMember();
    const logId = await upsertLog(t.mgrCtx1, { memberId: t.memberId, logType: "weekly", periodDate: WEEK, field: "issue", text: "국어 부족" });
    await addComment(t.mentorCtx1, logId, "@지점장1 학부모 통화 부탁드립니다");
    const mgrNotis = await listNotifications(t.mgrCtx1);
    expect(mgrNotis).toHaveLength(1);
    expect(mgrNotis[0].type).toBe("mention");
    expect(mgrNotis[0].payload).toMatchObject({ logId });

    await addComment(t.mgrCtx1, logId, "네 목요일에 하겠습니다");
    const mentorNotis = await listNotifications(t.mentorCtx1);
    expect(mentorNotis).toHaveLength(1);
    expect(mentorNotis[0].type).toBe("comment");
    // 자기 코멘트로는 자기에게 알림이 가지 않는다
    expect(await listNotifications(t.mgrCtx1)).toHaveLength(1);
  });

  it("로그 상세는 코멘트를 작성자 이름과 함께 시간순으로 준다", async () => {
    const t = await seedWithMember();
    const logId = await upsertLog(t.mgrCtx1, { memberId: t.memberId, logType: "weekly", periodDate: WEEK, field: "issue", text: "x" });
    await addComment(t.mentorCtx1, logId, "첫 코멘트");
    await addComment(t.mgrCtx1, logId, "둘째 코멘트");
    const log = await getLog(t.mentorCtx1, logId);
    expect(log.comments.map((c) => [c.authorName, c.body])).toEqual([
      ["멘토1", "첫 코멘트"],
      ["지점장1", "둘째 코멘트"],
    ]);
  });

  it("조교는 상담일지를 볼 수 없다", async () => {
    const t = await seedWithMember();
    const logId = await upsertLog(t.mgrCtx1, { memberId: t.memberId, logType: "weekly", periodDate: WEEK, field: "issue", text: "x" });
    await expect(getLog(t.asstCtx1, logId)).rejects.toThrow(ForbiddenError);
    await expect(weeklyGrid(t.asstCtx1, [WEEK])).rejects.toThrow(ForbiddenError);
  });
});

describe("집중관리일지 · 주간 그리드", () => {
  beforeEach(resetDb);

  it("지점의 등록 회원 × 주차 셀을 돌려주고 코멘트 수를 센다", async () => {
    const t = await seedWithMember();
    const logId = await upsertLog(t.mgrCtx1, { memberId: t.memberId, logType: "weekly", periodDate: WEEK, field: "issue", text: "국어 부족" });
    await addComment(t.mentorCtx1, logId, "확인");
    const grid = await weeklyGrid(t.mgrCtx1, [WEEK, "2026-09-07"]);
    expect(grid.members.map((m) => m.name)).toEqual(["홍길동"]);
    const cell = grid.cells[`${t.memberId}|${WEEK}`];
    expect(cell).toMatchObject({ logId, issueText: "국어 부족", resolutionText: null, commentCount: 1 });
    expect(grid.cells[`${t.memberId}|2026-09-07`]).toBeUndefined();
  });
});

describe("집중관리일지 · 조회 보조", () => {
  beforeEach(resetDb);

  it("findLogId는 있으면 id, 없으면 null", async () => {
    const t = await seedWithMember();
    const { findLogId } = await import("@/modules/counsel/repo");
    expect(await findLogId(t.mgrCtx1, t.memberId, "weekly", WEEK)).toBeNull();
    const id = await upsertLog(t.mgrCtx1, { memberId: t.memberId, logType: "weekly", periodDate: WEEK, field: "issue", text: "x" });
    expect(await findLogId(t.mgrCtx1, t.memberId, "weekly", WEEK)).toBe(id);
    expect(await findLogId(t.mgrCtx2, t.memberId, "weekly", WEEK)).toBeNull();
  });
});
