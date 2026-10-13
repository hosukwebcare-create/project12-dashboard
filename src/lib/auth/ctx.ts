import { and, asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db as defaultDb, type Db } from "@/db/client";
import { branches, memberships, users, type BranchRole, type BranchSettings } from "@/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { activeSession } from "@/modules/security/sessions";
import { sessionCookie, verifySession } from "./session";

export type Role = "hq_admin" | BranchRole;

export type Ctx = {
  userId: string;
  userName: string;
  isHqAdmin: boolean;
  /** 현재 활성 지점. 모든 repo 조회는 이 값으로 스코핑한다 */
  branchId: string;
  branchName: string;
  role: Role;
  settings: BranchSettings;
  memberships: { branchId: string; branchName: string; role: Role }[];
  /** 이 요청의 로그인 세션(auth_sessions). 테스트·배치로 만든 컨텍스트에는 없다 */
  sessionId?: string;
};

/**
 * 세션과 무관하게 사용자·지점으로 컨텍스트를 만든다 (테스트·배치용).
 * issuedAt(세션 토큰 발급 시각, 초)을 주면 그 뒤에 비밀번호가 바뀐 계정은 거절한다.
 * lockBranchId 를 주면(PIN 으로 들어온 세션) 그 지점만 쓸 수 있다.
 */
export async function buildCtx(
  userId: string,
  activeBranchId: string | null,
  deps: { db?: Db; issuedAt?: number; lockBranchId?: string | null } = {},
): Promise<Ctx | null> {
  const db = deps.db ?? defaultDb;
  const [user] = await db
    .select({ id: users.id, name: users.name, isHqAdmin: users.isHqAdmin, passwordChangedAt: users.passwordChangedAt })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.active, true)))
    .limit(1);
  if (!user) return null;
  // 비밀번호를 바꾼 뒤에 발급된 토큰만 유효하다.
  // JWT 의 iat 는 초 단위로 내림되므로 변경 시각도 초로 내려서 견준다. 이렇게 하면 방금 로그인한 세션이 잘못 끊기지 않는다.
  if (deps.issuedAt !== undefined && user.passwordChangedAt && Math.floor(user.passwordChangedAt.getTime() / 1000) > deps.issuedAt) return null;

  let list: { branchId: string; branchName: string; role: Role; settings: BranchSettings }[];
  if (user.isHqAdmin) {
    const rows = await db
      .select({ id: branches.id, name: branches.name, settings: branches.settings })
      .from(branches)
      .where(eq(branches.active, true))
      .orderBy(asc(branches.code));
    list = rows.map((b) => ({ branchId: b.id, branchName: b.name, role: "hq_admin" as const, settings: b.settings }));
  } else {
    const rows = await db
      .select({ id: branches.id, name: branches.name, settings: branches.settings, role: memberships.role })
      .from(memberships)
      .innerJoin(branches, eq(branches.id, memberships.branchId))
      .where(and(eq(memberships.userId, userId), eq(branches.active, true)))
      .orderBy(asc(branches.code));
    list = rows.map((b) => ({ branchId: b.id, branchName: b.name, role: b.role, settings: b.settings }));
  }
  if (deps.lockBranchId) list = list.filter((m) => m.branchId === deps.lockBranchId);
  if (list.length === 0) return null;

  const chosen = list.find((m) => m.branchId === activeBranchId) ?? list[0];
  return {
    userId: user.id,
    userName: user.name,
    isHqAdmin: user.isHqAdmin,
    branchId: chosen.branchId,
    branchName: chosen.branchName,
    role: chosen.role,
    settings: chosen.settings,
    memberships: list.map(({ branchId, branchName, role }) => ({ branchId, branchName, role })),
  };
}

/** 요청 세션에서 컨텍스트를 얻는다. 없으면 로그인으로 보낸다. */
export async function getCtx(): Promise<Ctx> {
  const ctx = await tryGetCtx();
  if (!ctx) redirect("/login");
  return ctx;
}

/**
 * 같은 요청 안에서는 한 번만 계산한다 (guarded 래퍼와 페이지가 각각 호출하므로).
 * 쿠키 서명만 믿지 않고 서버의 세션 기록이 살아 있는지 본다 — 로그아웃·강제 로그아웃한 쿠키는 여기서 끊긴다.
 */
export const tryGetCtx = cache(async (): Promise<Ctx | null> => {
  const store = await cookies();
  const session = await verifySession(store.get(sessionCookie.name)?.value);
  if (!session) return null;
  const live = await activeSession(session.sessionId, session.userId);
  if (!live) return null;
  const ctx = await buildCtx(session.userId, session.branchId, { issuedAt: session.issuedAt, lockBranchId: live.branchId });
  return ctx ? { ...ctx, sessionId: session.sessionId } : null;
});

export function requireRole(ctx: Ctx, ...roles: Role[]): void {
  if (!roles.includes(ctx.role)) throw new ForbiddenError();
}

export const MANAGER_ROLES: Role[] = ["hq_admin", "branch_manager"];
export const STAFF_ROLES: Role[] = ["hq_admin", "branch_manager", "mentor"];
export const ALL_ROLES: Role[] = ["hq_admin", "branch_manager", "mentor", "assistant"];

export const ROLE_LABEL: Record<Role, string> = {
  hq_admin: "본사 관리자",
  branch_manager: "지점장",
  mentor: "멘토",
  assistant: "조교",
};
