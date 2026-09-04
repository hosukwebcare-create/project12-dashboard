import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { addIssueComment, createIssue, getIssue, listIssues, updateIssue } from "@/modules/issues/repo";
import { createMember } from "@/modules/members/repo";
import { listNotifications } from "@/modules/notifications/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

describe("이슈함", () => {
  beforeEach(resetDb);

  it("조교가 만든 이슈는 지점장에게 알림이 가고 목록·상태 필터로 보인다", async () => {
    const t = await seedTwoBranches();
    const m = await createMember(t.mgrCtx1, { name: "홍길동", status: "enrolled", seatId: t.seats1[0].id, memberKind: "student", focusCare: false });
    const id = await createIssue(t.asstCtx1, { memberId: m, title: "휴대폰 사용", body: "R3에서 두 번째", severity: "normal", source: "manual" });
    expect((await listNotifications(t.mgrCtx1)).map((n) => n.type)).toEqual(["issue"]);
    expect((await listIssues(t.mgrCtx1, "open")).map((i) => i.id)).toEqual([id]);
    expect(await listIssues(t.mgrCtx1, "resolved")).toEqual([]);
    expect(await listIssues(t.mgrCtx2)).toEqual([]);
  });

  it("지점장이 상태를 resolved로 바꾸면 resolvedAt이 채워지고 보고자에게 알림이 간다", async () => {
    const t = await seedTwoBranches();
    const id = await createIssue(t.asstCtx1, { memberId: null, title: "정수기 고장", body: null, severity: "low", source: "manual" });
    await updateIssue(t.mgrCtx1, id, { status: "resolved" });
    const issue = await getIssue(t.mgrCtx1, id);
    expect(issue.status).toBe("resolved");
    expect(issue.resolvedAt).not.toBeNull();
    expect((await listNotifications(t.asstCtx1)).map((n) => n.type)).toEqual(["issue_status"]);
  });

  it("조교는 상태를 바꿀 수 없지만 코멘트는 남길 수 있다", async () => {
    const t = await seedTwoBranches();
    const id = await createIssue(t.asstCtx1, { memberId: null, title: "x", body: null, severity: "normal", source: "manual" });
    await expect(updateIssue(t.asstCtx1, id, { status: "resolved" })).rejects.toThrow(ForbiddenError);
    await addIssueComment(t.mgrCtx1, id, "확인했습니다");
    await addIssueComment(t.asstCtx1, id, "감사합니다");
    const issue = await getIssue(t.asstCtx1, id);
    expect(issue.comments.map((c) => c.authorName)).toEqual(["지점장1", "조교1"]);
    // 지점장 코멘트 → 조교(보고자)에게 알림
    expect((await listNotifications(t.asstCtx1)).map((n) => n.type)).toEqual(["issue_comment"]);
  });

  it("타 지점 이슈는 보이지 않는다", async () => {
    const t = await seedTwoBranches();
    const id = await createIssue(t.asstCtx1, { memberId: null, title: "x", body: null, severity: "normal", source: "manual" });
    await expect(getIssue(t.mgrCtx2, id)).rejects.toThrow(NotFoundError);
  });
});
