import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

/**
 * 파일 저장소 추상화.
 * - LocalStorage: 로컬 디스크 (개발·로컬 서버 운영, STORAGE_DIR)
 * - GcsStorage: Google Cloud Storage (Cloud Run 운영, STORAGE_DRIVER=gcs + GCS_BUCKET)
 */
export interface FileStorage {
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalStorage implements FileStorage {
  constructor(private baseDir: string) {}
  private path(key: string) {
    const base = normalize(this.baseDir);
    const p = normalize(join(base, key));
    if (!p.startsWith(base)) throw new Error("잘못된 저장 경로");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async get(key: string) {
    return readFile(this.path(key));
  }
  async delete(key: string) {
    await unlink(this.path(key)).catch(() => undefined);
  }
}

/** @google-cloud/storage 의 Bucket 중 우리가 쓰는 부분만. 테스트에서는 가짜 객체를 넣는다 */
export interface GcsBucketLike {
  file(name: string): {
    save(data: Buffer, options?: { contentType?: string; resumable?: boolean }): Promise<unknown>;
    download(): Promise<[Buffer]>;
    delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>;
  };
}

export class GcsStorage implements FileStorage {
  constructor(
    private bucket: GcsBucketLike,
    private prefix = "",
  ) {}
  private name(key: string) {
    const p = this.prefix.replace(/^\/+|\/+$/g, "");
    return p ? `${p}/${key}` : key;
  }
  async put(key: string, data: Buffer, contentType?: string) {
    await this.bucket.file(this.name(key)).save(data, { contentType, resumable: false });
  }
  async get(key: string) {
    const [buf] = await this.bucket.file(this.name(key)).download();
    return buf;
  }
  async delete(key: string) {
    await this.bucket.file(this.name(key)).delete({ ignoreNotFound: true });
  }
}

type StorageEnv = { STORAGE_DRIVER?: string; STORAGE_DIR?: string; GCS_BUCKET?: string; GCS_PREFIX?: string; [key: string]: string | undefined };

async function defaultBucketFactory(name: string): Promise<GcsBucketLike> {
  const { Storage } = await import("@google-cloud/storage");
  return new Storage().bucket(name) as unknown as GcsBucketLike;
}

/** 환경 변수로 저장소 구현을 고른다. bucketFactory 는 테스트용 주입점 */
export function resolveStorage(env: StorageEnv, bucketFactory: (name: string) => GcsBucketLike | Promise<GcsBucketLike> = defaultBucketFactory): FileStorage {
  if ((env.STORAGE_DRIVER ?? "local") === "gcs") {
    const bucketName = env.GCS_BUCKET;
    if (!bucketName) throw new Error("STORAGE_DRIVER=gcs 에는 GCS_BUCKET 이 필요합니다");
    const made = bucketFactory(bucketName);
    // 동기 팩토리(테스트)면 바로, 비동기(실제 SDK)면 지연 초기화 래퍼로 감싼다
    if (made instanceof Promise) return new LazyGcsStorage(made, env.GCS_PREFIX ?? "");
    return new GcsStorage(made, env.GCS_PREFIX ?? "");
  }
  return new LocalStorage(env.STORAGE_DIR ?? join(process.cwd(), "storage"));
}

class LazyGcsStorage implements FileStorage {
  private inner: Promise<GcsStorage>;
  constructor(bucket: Promise<GcsBucketLike>, prefix: string) {
    this.inner = bucket.then((b) => new GcsStorage(b, prefix));
  }
  put(key: string, data: Buffer, contentType?: string) {
    return this.inner.then((s) => s.put(key, data, contentType));
  }
  get(key: string) {
    return this.inner.then((s) => s.get(key));
  }
  delete(key: string) {
    return this.inner.then((s) => s.delete(key));
  }
}

let cached: FileStorage | null = null;
export function getStorage(): FileStorage {
  if (!cached) cached = resolveStorage(process.env);
  return cached;
}
