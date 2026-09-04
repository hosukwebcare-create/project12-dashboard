import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

/**
 * 파일 저장소 추상화.
 * - LocalStorage: 로컬 디스크 (개발·소규모 운영, STORAGE_DIR)
 * - 운영에서 GCS를 쓰려면 같은 인터페이스로 GcsStorage 를 구현해 getStorage() 에서 고르면 된다.
 */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalStorage implements FileStorage {
  constructor(private baseDir: string) {}
  private path(key: string) {
    const p = normalize(join(this.baseDir, key));
    if (!p.startsWith(normalize(this.baseDir))) throw new Error("잘못된 저장 경로");
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

let cached: FileStorage | null = null;
export function getStorage(): FileStorage {
  if (!cached) cached = new LocalStorage(process.env.STORAGE_DIR ?? join(process.cwd(), "storage"));
  return cached;
}
