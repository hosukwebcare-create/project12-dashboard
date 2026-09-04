import { ForbiddenError, NotFoundError, ValidationError } from "./errors";

export type ActionState = { error?: string; ok?: boolean };

/** 사용자에게 보여줄 수 있는 오류 메시지만 노출한다 */
export function toMessage(e: unknown): string {
  if (e instanceof ValidationError || e instanceof ForbiddenError || e instanceof NotFoundError) return e.message;
  if (e instanceof Error && /이미 사용 중|모두 진행/.test(e.message)) return e.message;
  console.error(e);
  return "처리 중 문제가 발생했습니다";
}
