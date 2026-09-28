import { describe, expect, it } from "vitest";
import { buildAttention, type AttentionInput } from "@/lib/rules/attention";

const base: AttentionInput = {
  nowTime: "10:30",
  completedRounds: [1, 2],
  roundsPerDay: 12,
  roundSchedule: ["09:00", "10:00", "11:00", "12:00"],
  missingWeekly: 0,
  weekStart: "2026-09-07",
  expiring: [],
  openIssues: [],
  money: null,
  unreadNotes: 0,
  todayAppointments: [],
};

describe("오늘 챙길 것", () => {
  it("다 처리됐으면 비어 있다", () => {
    expect(buildAttention(base)).toEqual([]);
  });

  it("시간표에서 시작 시각이 지났는데 완료하지 않은 회차가 있으면 라운딩을 올린다", () => {
    expect(buildAttention({ ...base, completedRounds: [1] }).map((x) => [x.key, x.level, x.title])).toEqual([["rounds", "warning", "R2 시작 시간이 지났습니다"]]);
    expect(buildAttention({ ...base, completedRounds: [] })[0]).toMatchObject({ key: "rounds", level: "urgent", title: "라운딩이 2회차 밀려 있습니다", detail: "R1·R2 미완료 · 시간표 기준" });
  });

  it("뒤 회차를 먼저 완료했어도 앞 회차가 밀린 것을 놓치지 않는다 (개수가 아니라 번호로)", () => {
    // R3 만 완료: 개수로는 1/2 지만 R1·R2 가 모두 밀렸다
    expect(buildAttention({ ...base, completedRounds: [3] })[0]).toMatchObject({ key: "rounds", level: "urgent", detail: "R1·R2 미완료 · 시간표 기준" });
    // R2 만 완료: R1 이 밀렸다
    expect(buildAttention({ ...base, completedRounds: [2, 3] })[0]).toMatchObject({ key: "rounds", title: "R1 시작 시간이 지났습니다" });
  });

  it("아무도 안 한 '해 주세요'가 있으면 인수인계로 안내한다", () => {
    expect(buildAttention({ ...base, openRequests: 2 })).toEqual([
      expect.objectContaining({ key: "requests", level: "warning", title: "해 주세요 2건이 남아 있습니다", href: "/handover#requests", target: "인수인계" }),
    ]);
    expect(buildAttention({ ...base, openRequests: 0 })).toEqual([]);
  });

  it("시간표가 없으면 라운딩 지연을 판단하지 않는다", () => {
    expect(buildAttention({ ...base, roundSchedule: [], completedRounds: [] })).toEqual([]);
  });

  it("급한 순서로 줄 세운다: 긴급 → 주의 → 참고", () => {
    const items = buildAttention({
      ...base,
      unreadNotes: 2,
      missingWeekly: 3,
      openIssues: [{ severity: "high" }, { severity: "normal" }],
      expiring: [{ name: "가", seatNo: 1, daysLeft: 2 }, { name: "나", seatNo: 2, daysLeft: 6 }],
      money: { pending: 4, amount: 1_000_000, unpriced: 1 },
      todayAppointments: [{ startTime: "15:00", displayName: "다" }, { startTime: "13:00", displayName: "라" }],
    });
    expect(items.map((x) => x.level)).toEqual(["urgent", "urgent", "warning", "warning", "info", "info", "info"]);
    expect(items.map((x) => x.key)).toEqual(["issues-high", "expiring-soon", "counsel", "unpriced", "money", "appointments", "handover"]);
    expect(items.find((x) => x.key === "expiring-soon")?.detail).toBe("1번 가");
    expect(items.find((x) => x.key === "appointments")?.detail).toBe("13:00 라부터");
    expect(items.find((x) => x.key === "money")?.title).toBe("받을 돈 4건 · 1,000,000원");
  });

  it("만료 3일 안이 없으면 7일 안으로 한 줄만", () => {
    const items = buildAttention({ ...base, expiring: [{ name: "가", seatNo: null, daysLeft: 5 }, { name: "나", seatNo: 3, daysLeft: 7 }, { name: "다", seatNo: 4, daysLeft: 7 }, { name: "라", seatNo: 5, daysLeft: 7 }] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "expiring", level: "warning", detail: "가, 3번 나, 4번 다 외 1명" });
  });
});
