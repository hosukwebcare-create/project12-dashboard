import { Plus, Upload } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { FocusBadge, StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MemberStatus } from "@/db/schema";
import { getCtx, MANAGER_ROLES } from "@/lib/auth/ctx";
import { listMembers } from "@/modules/members/repo";
import { MEMBER_STATUSES } from "@/modules/members/schema";
import { guarded } from "@/lib/page-guard";

export const metadata = { title: "회원" };

type Search = { status?: string; focus?: string; q?: string };

async function MembersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await getCtx();
  const sp = await searchParams;
  const status = MEMBER_STATUSES.includes(sp.status as MemberStatus) ? (sp.status as MemberStatus) : undefined;
  const focusCare = sp.focus === "1" ? true : undefined;
  const rows = await listMembers(ctx, { status, focusCare, q: sp.q });
  const canManage = MANAGER_ROLES.includes(ctx.role);
  const showPhone = ctx.role !== "assistant";

  const chip = (label: string, params: Search, active: boolean) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.focus) qs.set("focus", params.focus);
    if (sp.q) qs.set("q", sp.q);
    return (
      <Link href={`/members?${qs.toString()}`} className="pill" data-active={active}>
        {label}
      </Link>
    );
  };

  return (
    <div>
      <PageHeader
        title="회원"
        description={`${ctx.branchName} · ${rows.length}명`}
        actions={
          canManage ? (
            <>
              <Button asChild variant="outline">
                <Link href="/members/import">
                  <Upload /> CSV 이관
                </Link>
              </Button>
              <Button asChild>
                <Link href="/members/new">
                  <Plus /> 회원 등록
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="pill-nav">
          {chip("전체", {}, !status && !focusCare)}
          {chip("등록", { status: "enrolled" }, status === "enrolled")}
          {chip("상담", { status: "prospect" }, status === "prospect")}
          {chip("퇴원", { status: "withdrawn" }, status === "withdrawn")}
          {chip("집중관리", { focus: "1" }, Boolean(focusCare))}
        </div>
        <form className="ml-auto flex gap-2">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          {focusCare ? <input type="hidden" name="focus" value="1" /> : null}
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="이름·학교·좌석 검색" className="w-48" />
          <Button type="submit" variant="outline">
            검색
          </Button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg bg-card ring-1 ring-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs font-medium tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">좌석</th>
              <th className="px-3 py-2">이름</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2">구분</th>
              <th className="px-3 py-2">학교/학년</th>
              <th className="px-3 py-2">계열</th>
              {showPhone ? <th className="px-3 py-2">연락처</th> : null}
              <th className="px-3 py-2">특이사항</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  조건에 맞는 회원이 없습니다
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id} className="border-t hover:bg-accent/40">
                  <td className="px-3 py-2 tabular-nums">{m.seatNo ?? "-"}</td>
                  <td className="px-3 py-2">
                    <Link href={`/members/${m.id}`} className="font-medium hover:underline">
                      {m.name}
                    </Link>
                    {m.focusCare ? (
                      <span className="ml-2">
                        <FocusBadge />
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-3 py-2">
                    {m.memberKind === "adult" ? "성인" : "학생"}
                    {m.studentType ? ` · ${m.studentType}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    {m.school ?? ""}
                    {m.grade ? ` ${m.grade}` : ""}
                  </td>
                  <td className="px-3 py-2">{m.track ?? ""}</td>
                  {showPhone ? <td className="px-3 py-2 tabular-nums">{m.phone ?? ""}</td> : null}
                  <td className="max-w-56 truncate px-3 py-2 text-muted-foreground">{m.fieldNote ?? ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default guarded(MembersPage);
