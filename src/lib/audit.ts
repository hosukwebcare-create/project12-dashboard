import type { Db, Tx } from "@/db/client";
import { auditLogs } from "@/db/schema";
import type { Ctx } from "@/lib/auth/ctx";

export type AuditAction = "create" | "update" | "status" | "seat" | "delete";

/** 감사 로그에 그대로 남기면 안 되는 값 (해시·비밀번호는 통째로 지우고, 연락처는 뒷자리만 남긴다) */
const SECRET_KEY = /^(password|passwordHash|pin|pinHash|token|secret|apiKey|accessKey)$/i;
const PHONE_KEY = /(phone|mobile|tel|contact)$/i;
const RRN_KEY = /^(rrn|residentNo|ssn|birthNo)$/i;

/** 010-1234-5678 → 010-****-5678 */
function maskPhone(v: string): string {
  const digits = v.replace(/\D/g, "");
  if (digits.length < 7) return "*".repeat(v.length);
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

/**
 * 감사 로그로 남길 값에서 개인정보를 가린다.
 * 감사 로그는 "누가 무엇을 바꿨나"를 남기는 곳이지 개인정보를 한 번 더 쌓아 두는 곳이 아니다.
 */
export function maskSensitive(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => maskSensitive(v, depth + 1));
  if (value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) out[k] = v == null ? v : "***";
    else if (RRN_KEY.test(k)) out[k] = v == null ? v : "***";
    else if (PHONE_KEY.test(k) && typeof v === "string") out[k] = maskPhone(v);
    else out[k] = maskSensitive(v, depth + 1);
  }
  return out;
}

export async function writeAudit(
  tx: Db | Tx,
  ctx: Pick<Ctx, "userId" | "branchId">,
  entity: string,
  entityId: string,
  action: AuditAction,
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorId: ctx.userId,
    branchId: ctx.branchId,
    entity,
    entityId,
    action,
    before: maskSensitive(before) ?? null,
    after: maskSensitive(after) ?? null,
  });
}
