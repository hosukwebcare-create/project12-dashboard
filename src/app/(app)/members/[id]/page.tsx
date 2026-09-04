import { Pencil } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { PageHeader } from "@/components/app/page-header";
import { SeatAssignForm } from "@/components/app/seat-assign-form";
import { FocusBadge, StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCtx, MANAGER_ROLES } from "@/lib/auth/ctx";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { changeStatusAction } from "@/modules/members/actions";
import { getMember, listSeatsWithOccupant, memberTimeline } from "@/modules/members/repo";
import { MEMBER_STATUSES, STATUS_LABEL } from "@/modules/members/schema";
import { customFieldsFor } from "@/modules/settings/repo";
import { formatCustomValue } from "@/components/app/custom-fields";
import { MemberFileUpload } from "@/components/app/member-files";
import { FILE_KIND_LABEL, listMemberFiles } from "@/modules/files/repo";
import { listHeroLinks } from "@/modules/hero/repo";
import { STAFF_ROLES } from "@/lib/auth/ctx";
import { MemberWeekView } from "@/components/app/member-week";
import { memberWeek } from "@/modules/rounding/repo";
import { todayKey } from "@/lib/rules/week";
import { guarded } from "@/lib/page-guard";

async function MemberDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ week?: string }> }) {
  const ctx = await getCtx();
  const { id } = await params;
  const sp = await searchParams;
  const weekParam = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : todayKey();
  const member = await getMember(ctx, id);
  const canManage = MANAGER_ROLES.includes(ctx.role);
  const isStaff = STAFF_ROLES.includes(ctx.role);
  const [timeline, seats, customDefs, files, heroLinks] = await Promise.all([
    memberTimeline(ctx, id),
    canManage ? listSeatsWithOccupant(ctx) : Promise.resolve([]),
    customFieldsFor(ctx, "member"),
    isStaff ? listMemberFiles(ctx, id) : Promise.resolve([]),
    isStaff ? listHeroLinks(ctx, id) : Promise.resolve([]),
  ]);
  const week = member.status === "enrolled" || member.status === "paused" ? await memberWeek(ctx, id, weekParam) : null;

  const info: [string, string][] = [
    ["구분", `${member.memberKind === "adult" ? "성인" : "학생"}${member.studentType ? ` · ${member.studentType}` : ""}`],
    ["학교/학년", `${member.school ?? "-"}${member.grade ? ` ${member.grade}학년` : ""}`],
    ["계열", member.track ?? "-"],
    ["목표", member.target ?? "-"],
    ["성별", member.gender ?? "-"],
    ["생년월일", fmtDate(member.birthDate)],
    ["연락처", member.phone ?? "-"],
    ["주소", member.address ?? "-"],
    ["첫 등록일", fmtDate(member.firstRegisteredAt)],
    ["첫 상담일", fmtDate(member.firstCounseledAt)],
    ["라운딩 특이사항", member.fieldNote ?? "-"],
    ...customDefs.map((d): [string, string] => [d.label, formatCustomValue(d, member.custom[d.key])]),
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={member.name}
        description={`${member.seatNo ? `${member.seatNo}번 좌석 (${member.zone})` : "좌석 미배정"} · ${ctx.branchName}`}
        actions={
          canManage ? (
            <Button asChild variant="outline">
              <Link href={`/members/${member.id}/edit`}>
                <Pencil /> 정보 수정
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={member.status} />
        {member.focusCare ? <FocusBadge /> : null}
        {member.currentEnrollment ? (
          <span className="text-sm text-muted-foreground">
            등록 {fmtDate(member.currentEnrollment.startDate)} ~ {fmtDate(member.currentEnrollment.endDate)} · 잔여 {member.daysLeft}일
            {member.currentEnrollment.planType === "short" ? " · 단기" : ""}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">유효한 등록기간 없음</span>
        )}
      </div>

      <Tabs defaultValue={sp.week ? "week" : "info"}>
        <TabsList>
          <TabsTrigger value="info">기본정보</TabsTrigger>
          <TabsTrigger value="timeline">타임라인 ({timeline.length})</TabsTrigger>
          {week ? <TabsTrigger value="week">라운딩 · 벌점</TabsTrigger> : null}
          {isStaff ? <TabsTrigger value="files">파일 · 진단 ({files.length + heroLinks.length})</TabsTrigger> : null}
          {canManage ? <TabsTrigger value="manage">좌석 · 상태</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="info" className="mt-4 grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>기본 정보</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
                {info.map(([k, v]) => (
                  <Fragment key={k}>
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd>{v}</dd>
                  </Fragment>
                ))}
              </dl>
              {member.memo ? <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{member.memo}</p> : null}
            </CardContent>
          </Card>
          <div className="space-y-4">
            {ctx.role !== "assistant" ? (
              <Card>
                <CardHeader>
                  <CardTitle>학부모</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {member.guardians.length === 0 ? (
                    <p className="text-muted-foreground">등록된 학부모 정보가 없습니다</p>
                  ) : (
                    member.guardians.map((g) => (
                      <p key={g.id}>
                        {g.name ?? "-"} ({g.relation ?? "-"}) · {g.phone ?? "-"}
                      </p>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>등록 이력</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {member.enrollments.length === 0 ? (
                  <p className="text-muted-foreground">등록 이력이 없습니다</p>
                ) : (
                  <ul className="space-y-1">
                    {member.enrollments.map((e) => (
                      <li key={e.id} className="flex justify-between">
                        <span>
                          {fmtDate(e.startDate)} ~ {fmtDate(e.endDate)}
                        </span>
                        <span className="text-muted-foreground">
                          {e.planType === "short" ? "단기" : "정기"}
                          {e.note ? ` · ${e.note}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          {timeline.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">기록이 없습니다</p>
          ) : (
            <ol className="relative space-y-4 border-l pl-5">
              {timeline.map((t, i) => (
                <li key={i} className="relative">
                  <span className={`absolute -left-[26px] top-1.5 size-2.5 rounded-full ${dotColor(t.kind)}`} />
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    {t.href ? (
                      <Link href={t.href} className="font-medium hover:underline">
                        {t.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{t.title}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {fmtDateTime(t.at)}
                      {t.actor ? ` · ${t.actor}` : ""}
                    </span>
                  </div>
                  {t.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </TabsContent>

        {week ? (
          <TabsContent value="week" className="mt-4" id="week">
            <MemberWeekView memberId={member.id} week={week} />
          </TabsContent>
        ) : null}

        {isStaff ? (
          <TabsContent value="files" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>HERO 학습진단</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {heroLinks.length === 0 ? (
                  <p className="text-muted-foreground">연결된 진단 결과가 없습니다. HERO 웹앱이 설문 완료 시 자동으로 연결됩니다.</p>
                ) : (
                  <ul className="space-y-2">
                    {heroLinks.map((h) => (
                      <li key={h.id} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{h.takenAt ? fmtDateTime(h.takenAt) : fmtDateTime(h.createdAt)}</span>
                          {h.resultUrl ? (
                            <a href={h.resultUrl} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">
                              결과분석지 열기
                            </a>
                          ) : null}
                        </div>
                        {Object.keys(h.summary).length ? (
                          <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
                            {Object.entries(h.summary).map(([k, v]) => (
                              <Fragment key={k}>
                                <dt className="text-muted-foreground">{k}</dt>
                                <dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                              </Fragment>
                            ))}
                          </dl>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>파일 (AI 컨설팅 리포트 등)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {files.length === 0 ? (
                  <p className="text-muted-foreground">올린 파일이 없습니다</p>
                ) : (
                  <ul className="divide-y">
                    {files.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                        <span className="rounded bg-muted px-1.5 text-xs">{FILE_KIND_LABEL[f.kind]}</span>
                        <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                          {f.title}
                        </a>
                        <span className="text-xs text-muted-foreground">
                          v{f.version} · {f.fileName} · {(f.size / 1024).toFixed(0)}KB · {f.uploaderName ?? "-"} · {fmtDateTime(f.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <MemberFileUpload memberId={member.id} />
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {canManage ? (
          <TabsContent value="manage" className="mt-4 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>좌석 배정</CardTitle>
              </CardHeader>
              <CardContent>
                {member.status === "enrolled" || member.status === "paused" ? (
                  <SeatAssignForm memberId={member.id} currentSeatId={member.seatId} seats={seats} />
                ) : (
                  <p className="text-sm text-muted-foreground">등록 상태에서만 좌석을 배정할 수 있습니다</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>상태 변경</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={changeStatusAction} className="flex gap-2">
                  <input type="hidden" name="id" value={member.id} />
                  <select name="status" defaultValue={member.status} className="h-9 flex-1 rounded-md border bg-background px-3 text-sm">
                    {MEMBER_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="outline">
                    변경
                  </Button>
                </form>
                <p className="mt-2 text-xs text-muted-foreground">퇴원·상담으로 바꾸면 좌석이 자동으로 해제됩니다</p>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

function dotColor(kind: string) {
  switch (kind) {
    case "penalty":
      return "bg-red-500";
    case "issue":
      return "bg-amber-500";
    case "counsel":
      return "bg-violet-500";
    case "comment":
      return "bg-sky-500";
    default:
      return "bg-neutral-400";
  }
}

export default guarded(MemberDetailPage);
