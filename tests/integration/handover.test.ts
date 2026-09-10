import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { addComment, deleteNote, listComments, listNotes, markAllRead, markRead, unreadNoteCount, upsertNote } from "@/modules/handover/repo";
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
