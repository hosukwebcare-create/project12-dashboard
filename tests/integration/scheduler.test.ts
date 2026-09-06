import { describe, expect, it } from "vitest";
import { withJobLock } from "@/lib/scheduler";

describe("배치 자문 잠금", () => {
  it("같은 배치가 겹쳐 돌지 않는다 (인스턴스가 여러 대여도 한 번만)", async () => {
    let inner: unknown = "안 돌았음";
    const outer = await withJobLock(91, async () => {
      // 첫 번째가 잠금을 쥔 동안 두 번째는 잡지 못하고 바로 돌아온다
      inner = await withJobLock(91, async () => "돌았음");
      return "완료";
    });
    expect(outer).toBe("완료");
    expect(inner).toBeNull();
  });

  it("잠금은 다 쓰면 풀린다", async () => {
    expect(await withJobLock(92, async () => 1)).toBe(1);
    expect(await withJobLock(92, async () => 2)).toBe(2);
  });

  it("작업이 실패해도 잠금은 풀린다", async () => {
    await expect(withJobLock(93, async () => Promise.reject(new Error("실패")))).rejects.toThrow("실패");
    expect(await withJobLock(93, async () => "다음 주기")).toBe("다음 주기");
  });

  it("배치가 다르면 서로 막지 않는다", async () => {
    const other = await withJobLock(94, async () => withJobLock(95, async () => "동시 실행"));
    expect(other).toBe("동시 실행");
  });
});
