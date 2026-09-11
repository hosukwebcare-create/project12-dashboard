import { describe, expect, it } from "vitest";
import { buildAttention, type AttentionInput } from "@/lib/rules/attention";

const base: AttentionInput = {
  nowTime: "10:30",
  sessionsDone: 2,
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

  it("시간표에서 지난 회차보다 완료가 적으면 라운딩을 올린다", () => {
    expect(buildAttention({ ...base, sessionsDone: 1 }).map((x) => [x.key, x.level])).toEqual([["rounds", "warning"]]);
    expect(buildAttention({ ...base, sessionsDone: 0 })[0]).toMatchObject({ key: "rounds", level: "urgent", title: "라운딩이 2회차 밀려 있습니다" });
  });

  it("시간표가 없으면 라운딩 지연을 판단하지 않는다", () => {
    expect(buildAttention({ ...base, roundSchedule: [], sessionsDone: 0 })).toEqual([]);
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
