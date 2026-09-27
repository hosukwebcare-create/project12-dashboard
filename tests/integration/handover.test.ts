import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { addComment, deleteNote, listComments, listNotes, listRequests, markAllRead, markRead, openRequestCount, setRequestDone, slotOptions, unreadNoteCount, upsertNote } from "@/modules/handover/repo";
import { upsertShiftSlot } from "@/modules/worklog/repo";
import { listNotifications } from "@/modules/notifications/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

const TODAY = "2026-09-07";

describe("인수인계 노트", () => {
  beforeEach(resetDb);

  it("남의 글은 안 읽음으로, 내 글은 아니다", async () => {
    const t = await seedTwoBranches();
    await upsertNote(t.asstCtx1, { date: TODAY, kind: "handover", body: "12번 스탠드 깜빡임" });

    // 쓴 사람에게는 안 읽음이 아니다
    expect(await unreadNoteCount(t.asstCtx1, 14, TODAY)).toBe(0);
    // 다른 근무자에게는 안 읽음
    expect(await unreadNoteCount(t.mgrCtx1, 14, TODAY)).toBe(1);
    expect((await listNotes(t.mgrCtx1, 14, TODAY))[0].unread).toBe(true);
  });

  it("읽으면 사라지고, 읽은 사람 수가 쌓인다", async () => {
    const t = await seedTwoBranches();
    const id = await upsertNote(t.asstCtx1, { date: TODAY, kind: "handover", body: "정수기 필터 교체함" });

    await markRead(t.mgrCtx1, [id]);
    expect(await unreadNoteCount(t.mgrCtx1, 14, TODAY)).toBe(0);
    await markRead(t.mgrCtx1, [id]); // 두 번 눌러도 문제없다
    await markRead(t.mentorCtx1, [id]);

    const [note] = await listNotes(t.asstCtx1, 14, TODAY);
    expect(note.readCount).toBe(2);
    expect(note.unread).toBe(false);
  });

  it("'모두 읽음'은 안 읽은 것만 처리한다", async () => {
    const t = await seedTwoBranches();
    await upsertNote(t.asstCtx1, { date: TODAY, kind: "handover", body: "가" });
    await upsertNote(t.mentorCtx1, { date: TODAY, kind: "handover", body: "나" });
    expect(await markAllRead(t.mgrCtx1, 14, TODAY)).toBe(2);
    expect(await markAllRead(t.mgrCtx1, 14, TODAY)).toBe(0);
    expect(await unreadNoteCount(t.mgrCtx1, 14, TODAY)).toBe(0);
  });

  it("공지는 지점장·본사만 쓰고, 쓰면 지점 사람들에게 알림이 간다", async () => {
    const t = await seedTwoBranches();
    await expect(upsertNote(t.asstCtx1, { date: TODAY, kind: "notice", body: "공지입니다" })).rejects.toThrow(ForbiddenError);

    await upsertNote(t.mgrCtx1, { date: TODAY, kind: "notice", body: "이번 주 청소 당번 변경" });
    const asstNotes = await listNotifications(t.asstCtx1);
    expect(asstNotes.some((n) => String((n.payload as Record<string, unknown>).title).includes("공지"))).toBe(true);
    // 쓴 사람 자신에게는 안 간다
    expect(await listNotifications(t.mgrCtx1)).toHaveLength(0);
  });

  it("공지가 목록 맨 위로 올라온다", async () => {
    const t = await seedTwoBranches();
    await upsertNote(t.asstCtx1, { date: TODAY, kind: "handover", body: "인수인계 글" });
    await upsertNote(t.mgrCtx1, { date: "2026-09-01", kind: "notice", body: "오래된 공지" });
    expect((await listNotes(t.mentorCtx1, 14, TODAY)).map((n) => n.kind)).toEqual(["notice", "handover"]);
  });

  it("답글을 달면 글쓴이에게 알림이 간다", async () => {
    const t = await seedTwoBranches();
    const id = await upsertNote(t.asstCtx1, { date: TODAY, kind: "handover", body: "에어컨 리모컨 못 찾음" });
    await addComment(t.mgrCtx1, id, "카운터 서랍에 있습니다");

    expect((await listComments(t.asstCtx1, id)).map((c) => c.body)).toEqual(["카운터 서랍에 있습니다"]);
    const notes = await listNotifications(t.asstCtx1);
    expect(notes.some((n) => String((n.payload as Record<string, unknown>).title).includes("답글"))).toBe(true);
    expect((await listNotes(t.asstCtx1, 14, TODAY))[0].commentCount).toBe(1);
  });

  it("빈 글·빈 답글은 거절한다", async () => {
    const t = await seedTwoBranches();
    await expect(upsertNote(t.asstCtx1, { date: TODAY, kind: "handover", body: "   " })).rejects.toThrow(ValidationError);
    const id = await upsertNote(t.asstCtx1, { date: TODAY, kind: "handover", body: "가" });
    await expect(addComment(t.mgrCtx1, id, " ")).rejects.toThrow(ValidationError);
  });

  it("남의 글은 지점장만 지운다", async () => {
    const t = await seedTwoBranches();
    const id = await upsertNote(t.asstCtx1, { date: TODAY, kind: "handover", body: "가" });
    await expect(deleteNote(t.mentorCtx1, id)).rejects.toThrow(ForbiddenError);
    await deleteNote(t.asstCtx1, id); // 자기 글은 지울 수 있다
    expect(await listNotes(t.mgrCtx1, 14, TODAY)).toHaveLength(0);
  });

  it("다른 지점 글은 읽음 표시도 할 수 없다", async () => {
    const t = await seedTwoBranches();
    const id = await upsertNote(t.asstCtx1, { date: TODAY, kind: "handover", body: "지점1 인수인계" });
    // 지점2 사람이 지점1 글 id 를 알아내도 읽음 수를 올릴 수 없다
    await markRead(t.mgrCtx2, [id]);
    expect((await listNotes(t.mgrCtx1, 14, TODAY))[0].readCount).toBe(0);
    // 자기 지점 글은 정상 동작
    await markRead(t.mgrCtx1, [id]);
    expect((await listNotes(t.asstCtx1, 14, TODAY))[0].readCount).toBe(1);
  });

  it("다른 지점 글은 보이지 않는다", async () => {
    const t = await seedTwoBranches();
    await upsertNote(t.asstCtx1, { date: TODAY, kind: "handover", body: "지점1 인수인계" });
    expect(await listNotes(t.mgrCtx2, 14, TODAY)).toHaveLength(0);
    expect(await unreadNoteCount(t.mgrCtx2, 14, TODAY)).toBe(0);
  });
});

describe("해 주세요", () => {
  beforeEach(resetDb);

  it("맡긴 일은 인수인계 목록이 아니라 '해 주세요' 칸에 모이고, 누가 해 놓으면 부탁한 사람에게 알린다", async () => {
    const t = await seedTwoBranches();
    const id = await upsertNote(t.mgrCtx1, { date: TODAY, kind: "request", body: "12번 스탠드 업체에 전화해 주세요" });
    await upsertNote(t.asstCtx1, { date: TODAY, kind: "handover", body: "정수기 필터 교체함" });

    expect((await listNotes(t.asstCtx1, 14, TODAY)).map((n) => n.kind)).toEqual(["handover"]);
    let r = await listRequests(t.asstCtx1, TODAY);
    expect(r.open.map((n) => n.body)).toEqual(["12번 스탠드 업체에 전화해 주세요"]);
    expect(await openRequestCount(t.asstCtx1)).toBe(1);
    // 다른 지점에는 보이지 않는다
    expect(await openRequestCount(t.mgrCtx2)).toBe(0);

    await setRequestDone(t.asstCtx1, id, true);
    r = await listRequests(t.asstCtx1, TODAY);
    expect(r.open).toEqual([]);
    expect(r.done.map((n) => [n.body, n.doneByName])).toEqual([["12번 스탠드 업체에 전화해 주세요", "조교1"]]);
    expect(await openRequestCount(t.asstCtx1)).toBe(0);
    const noti = await listNotifications(t.mgrCtx1);
    expect(noti.some((n) => String((n.payload as { title?: string }).title ?? "").includes("해 놓았어요"))).toBe(true);

    // 되돌리면 다시 남은 일
    await setRequestDone(t.mentorCtx1, id, false);
    expect(await openRequestCount(t.asstCtx1)).toBe(1);
  });

  it("인수인계 글은 완료로 표시하지 않는다", async () => {
    const t = await seedTwoBranches();
    const id = await upsertNote(t.asstCtx1, { date: TODAY, kind: "handover", body: "가" });
    await expect(setRequestDone(t.mgrCtx1, id, true)).rejects.toThrow(ValidationError);
  });

  it("근무 타임 고르기에는 근무 형태가 붙고 쉬는 타임은 빠진다 (1타임이 여럿이라)", async () => {
    const t = await seedTwoBranches();
    await upsertShiftSlot(t.mgrCtx1, { key: "d1", label: "1타임", startTime: "", endTime: "", minutes: 60, weekend: false, audience: "주간조교", sort: 1, active: true });
    await upsertShiftSlot(t.mgrCtx1, { key: "m1", label: "1타임", startTime: "16:00", endTime: "23:00", minutes: 360, weekend: false, audience: "원장", sort: 2, active: true });
    await upsertShiftSlot(t.mgrCtx1, { key: "c1", label: "1타임", startTime: "", endTime: "", minutes: 240, weekend: false, audience: "컨설팅", sort: 3, active: false });
    expect((await slotOptions(t.mgrCtx1)).map((o) => o.name)).toEqual(["주간조교 1타임", "원장 1타임"]);
  });
});
