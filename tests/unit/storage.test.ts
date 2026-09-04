import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GcsStorage, LocalStorage, resolveStorage, type GcsBucketLike } from "@/lib/storage";

describe("LocalStorage", () => {
  it("저장·조회·삭제, 상위 경로 탈출은 거부", async () => {
    const s = new LocalStorage(mkdtempSync(join(tmpdir(), "byeolha-st-")));
    await s.put("b1/m1/a.pdf", Buffer.from("x"));
    expect((await s.get("b1/m1/a.pdf")).toString()).toBe("x");
    await s.delete("b1/m1/a.pdf");
    await expect(s.get("b1/m1/a.pdf")).rejects.toThrow();
    await expect(s.put("../escape.txt", Buffer.from("x"))).rejects.toThrow(/경로/);
  });
});

function fakeBucket() {
  const store = new Map<string, Buffer>();
  const calls: string[] = [];
  const bucket: GcsBucketLike = {
    file(key: string) {
      return {
        async save(data: Buffer, opts?: { contentType?: string }) {
          calls.push(`save:${key}:${opts?.contentType ?? ""}`);
          store.set(key, Buffer.from(data));
        },
        async download() {
          calls.push(`download:${key}`);
          const b = store.get(key);
          if (!b) throw new Error("No such object");
          return [b];
        },
        async delete() {
          calls.push(`delete:${key}`);
          store.delete(key);
        },
      };
    },
  };
  return { bucket, store, calls };
}

describe("GcsStorage", () => {
  it("버킷 객체 이름은 prefix/key 이고 save·download·delete 를 호출한다", async () => {
    const { bucket, store, calls } = fakeBucket();
    const s = new GcsStorage(bucket, "byeolha");
    await s.put("b1/m1/a.pdf", Buffer.from("pdf"), "application/pdf");
    expect(store.has("byeolha/b1/m1/a.pdf")).toBe(true);
    expect((await s.get("b1/m1/a.pdf")).toString()).toBe("pdf");
    await s.delete("b1/m1/a.pdf");
    expect(store.size).toBe(0);
    expect(calls).toEqual(["save:byeolha/b1/m1/a.pdf:application/pdf", "download:byeolha/b1/m1/a.pdf", "delete:byeolha/b1/m1/a.pdf"]);
  });
  it("prefix 가 없으면 key 그대로", async () => {
    const { bucket, store } = fakeBucket();
    await new GcsStorage(bucket, "").put("k", Buffer.from("v"));
    expect([...store.keys()]).toEqual(["k"]);
  });
});

describe("resolveStorage", () => {
  it("STORAGE_DRIVER=gcs 는 버킷이 없으면 오류, 기본은 로컬", () => {
    expect(resolveStorage({ STORAGE_DRIVER: "local", STORAGE_DIR: "/tmp/x" })).toBeInstanceOf(LocalStorage);
    expect(() => resolveStorage({ STORAGE_DRIVER: "gcs" })).toThrow(/GCS_BUCKET/);
    expect(resolveStorage({ STORAGE_DRIVER: "gcs", GCS_BUCKET: "b" }, () => fakeBucket().bucket)).toBeInstanceOf(GcsStorage);
  });
});
