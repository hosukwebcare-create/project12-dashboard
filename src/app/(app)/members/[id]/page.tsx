import { Pencil } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { formatCustomValue } from "@/components/app/custom-fields";
import { MemberFileUpload } from "@/components/app/member-files";
import { MemberWeekView } from "@/components/app/member-week";
import { SeatAssignForm } from "@/components/app/seat-assign-form";
import { FocusBadge, StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { InlineForm } from "@/components/app/inline-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCtx, MANAGER_ROLES, STAFF_ROLES } from "@/lib/auth/ctx";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { todayKey } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import { FILE_KIND_LABEL, listMemberFiles } from "@/modules/files/repo";
import { listHeroLinks } from "@/modules/hero/repo";
import { changeStatusAction, transferMemberAction } from "@/modules/members/actions";
import { getMember, listSeatsWithOccupant, memberTimeline, transferTargets } from "@/modules/members/repo";
import { MEMBER_STATUSES, STATUS_LABEL } from "@/modules/members/schema";
import { memberWeek } from "@/modules/rounding/repo";
import { customFieldsFor } from "@/modules/settings/repo";

/** 라벨·값 목록. 값이 없으면 흐리게 "-" */
function Facts({ items, cols = 1 }: { items: [string, ReactNode][]; cols?: 1 | 2 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-2.5 text-sm", cols === 2 ? "grid-cols-[6.5rem_1fr] sm:grid-cols-[6.5rem_1fr_6.5rem_1fr]" : "grid-cols-[6.5rem_1fr]")}>
      {items.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className={cn("min-w-0 break-words", (v === "-" || v === null || v === "") && "text-muted-foreground/60")}>{v || "-"}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

const TIMELINE_KIND: Record<string, { label: string; dot: string }> = {
  penalty: { label: "벌점", dot: "bg-rose-500" },
  issue: { label: "이슈", dot: "bg-amber-500" },
  counsel: { label: "상담", dot: "bg-foreground/70" },
  comment: { label: "코멘트", dot: "bg-foreground/40" },
  audit: { label: "변경", dot: "bg-border" },
};

async function MemberDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ week?: string }> }) {
  const ctx = await getCtx();
  const { id } = await params;
  const sp = await searchParams;
  const weekParam = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : todayKey();
  const member = await getMember(ctx, id);
  const canManage = MANAGER_ROLES.includes(ctx.role);
  const isStaff = STAFF_ROLES.includes(ctx.role);
  const showPhone = ctx.role !== "assistant";
  const [timeline, seats, customDefs, files, heroLinks, transferTo] = await Promise.all([
    memberTimeline(ctx, id),
    canManage ? listSeatsWithOccupant(ctx) : Promise.resolve([]),
    customFieldsFor(ctx, "member"),
    isStaff ? listMemberFiles(ctx, id) : Promise.resolve([]),
    isStaff ? listHeroLinks(ctx, id) : Promise.resolve([]),
    canManage ? transferTargets(ctx) : Promise.resolve([]),
  ]);
  const week = member.status === "enrolled" || member.status === "paused" ? await memberWeek(ctx, id, weekParam) : null;

  const kindLabel = `${member.memberKind === "adult" ? "성인" : "학생"}${member.studentType ? ` · ${member.studentType}` : ""}`;
  const schoolLabel = member.school ? `${member.school}${member.grade ? ` ${member.grade}학년` : ""}` : "-";
  const enrollment = member.currentEnrollment;
  const enrollPct = (() => {
    if (!enrollment) return 0;
    const s = new Date(enrollment.startDate).getTime();
    const e = new Date(enrollment.endDate).getTime();
    const n = new Date(todayKey()).getTime();
    if (e <= s) return 100;
    return Math.min(100, Math.max(0, Math.round(((n - s) / (e - s)) * 100)));
  })();

  const academic: [string, ReactNode][] = [
    ["구분", kindLabel],
    ["학교/학년", schoolLabel],
    ["계열", member.track ?? "-"],
    ["목표", member.target ?? "-"],
  ];
  const personal: [string, ReactNode][] = [
    ["성별", member.gender ?? "-"],
    ["생년월일", fmtDate(member.birthDate)],
    ["연락처", member.phone ?? "-"],
    ["주소", member.address ?? "-"],
    ["마케팅 수신 동의", member.marketingOptIn === true ? "동의" : member.marketingOptIn === false ? "거부" : "미확인"],
  ];
  const dates: [string, ReactNode][] = [
    ["첫 등록일", fmtDate(member.firstRegisteredAt)],
    ["첫 상담일", fmtDate(member.firstCounseledAt)],
  ];
  const custom: [string, ReactNode][] = customDefs.map((d) => [d.label, formatCustomValue(d, member.custom[d.key])]);

  return (
    <div className="mx-auto max-w-5xl">
      {/* 머리: 이름 · 상태 · 요약 한 줄 · 등록기간. 상자 없이 선으로만 나눈다 */}
      <div className="mb-6 border-b border-border pb-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{member.name}</h1>
              <StatusBadge status={member.status} />
              {member.focusCare ? <FocusBadge /> : null}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {[member.seatNo ? `${member.seatNo}번 좌석 (${member.zone})` : "좌석 미배정", kindLabel, member.school ? schoolLabel : null, member.track, showPhone ? member.phone : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/members">회원 목록</Link>
            </Button>
            {canManage ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/members/${member.id}/edit`}>
                  <Pencil /> 정보 수정
                </Link>
              </Button>
            ) : null}
          </div>
        </div>

        <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">등록기간</dt>
            {enrollment ? (
              <dd className="mt-0.5">
                <span className="font-medium">
                  {fmtDate(enrollment.startDate)} ~ {fmtDate(enrollment.endDate)}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {enrollment.planType === "short" ? "단기 · " : ""}잔여 <span className={cn("font-medium", (member.daysLeft ?? 0) <= 7 ? "text-amber-700" : "text-foreground")}>{member.daysLeft}일</span>
                </span>
                <span className="mt-2 block h-0.5 w-full max-w-xs bg-border" aria-hidden>
                  <span className={cn("block h-full", (member.daysLeft ?? 0) <= 7 ? "bg-amber-600" : "bg-foreground")} style={{ width: `${enrollPct}%` }} />
                </span>
              </dd>
            ) : (
              <dd className="mt-0.5 text-muted-foreground">유효한 등록기간 없음</dd>
            )}
          </div>
          {member.fieldNote ? (
            <div>
              <dt className="text-xs text-muted-foreground">라운딩 특이사항</dt>
              <dd className="mt-0.5 font-medium text-amber-900">{member.fieldNote}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <Tabs defaultValue={sp.week ? "week" : "info"}>
        <TabsList variant="line" className="h-auto w-full justify-start gap-5 border-b border-border p-0">
          <TabsTrigger value="info" className="flex-none px-0 pb-2">
            기본정보
          </TabsTrigger>
          <TabsTrigger value="timeline" className="flex-none px-0 pb-2">
            타임라인 ({timeline.length})
          </TabsTrigger>
          {week ? (
            <TabsTrigger value="week" className="flex-none px-0 pb-2">
              라운딩 · 벌점
            </TabsTrigger>
          ) : null}
          {isStaff ? (
            <TabsTrigger value="files" className="flex-none px-0 pb-2">
              파일 · 진단 ({files.length + heroLinks.length})
            </TabsTrigger>
          ) : null}
          {canManage ? (
            <TabsTrigger value="manage" className="flex-none px-0 pb-2">
              좌석 · 상태
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="info" className="mt-4 grid gap-4 md:grid-cols-5">
          <Card className="md:col-span-3">
            <CardHeader className="border-b">
              <CardTitle>기본 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <section>
                <p className="section-title mb-2">학적</p>
                <Facts items={academic} />
              </section>
              {showPhone ? (
                <section>
                  <p className="section-title mb-2">인적 사항</p>
                  <Facts items={personal} />
                </section>
              ) : null}
              <section>
                <p className="section-title mb-2">등록</p>
                <Facts items={dates} />
              </section>
              {custom.length ? (
                <section>
                  <p className="section-title mb-2">추가 정보</p>
                  <Facts items={custom} />
                </section>
              ) : null}
              {member.memo ? (
                <section>
                  <p className="section-title mb-2">메모</p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{member.memo}</p>
                </section>
              ) : null}
            </CardContent>
          </Card>
          <div className="space-y-4 md:col-span-2">
            {showPhone ? (
              <Card>
                <CardHeader className="border-b">
                  <CardTitle>학부모</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {member.guardians.length === 0 ? (
                    <p className="text-muted-foreground">등록된 학부모 정보가 없습니다</p>
                  ) : (
                    <ul className="space-y-2">
                      {member.guardians.map((g) => (
                        <li key={g.id} className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {g.name ?? "-"} <span className="font-normal text-muted-foreground">({g.relation ?? "-"})</span>
                          </span>
                          <span className="text-muted-foreground">{g.phone ?? "-"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ) : null}
            <Card>
              <CardHeader className="border-b">
                <CardTitle>등록 이력</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {member.enrollments.length === 0 ? (
                  <p className="text-muted-foreground">등록 이력이 없습니다</p>
                ) : (
                  <ul className="divide-y divide-border/70">
                    {member.enrollments.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                        <span>
                          {fmtDate(e.startDate)} ~ {fmtDate(e.endDate)}
                        </span>
                        <span className="text-xs text-muted-foreground">
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
          <Card>
            <CardContent>
              {timeline.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">기록이 없습니다</p>
              ) : (
                <ol className="relative space-y-5 border-l border-border pl-6">
                  {timeline.map((t, i) => {
                    const k = TIMELINE_KIND[t.kind] ?? TIMELINE_KIND.audit;
                    return (
                      <li key={i} className="relative">
                        <span className={cn("absolute top-1.5 -left-[29px] size-2 rounded-full ring-4 ring-card", k.dot)} aria-hidden />
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                          <span className="w-9 text-xs text-muted-foreground">{k.label}</span>
                          {t.href ? (
                            <Link href={t.href} className="font-medium underline-offset-4 hover:underline">
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
                        {t.body ? <p className="mt-1 pl-11 text-sm whitespace-pre-wrap text-muted-foreground">{t.body}</p> : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {week ? (
          <TabsContent value="week" className="mt-4" id="week">
            <MemberWeekView memberId={member.id} week={week} />
          </TabsContent>
        ) : null}

        {isStaff ? (
          <TabsContent value="files" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="border-b">
                <CardTitle>HERO 학습진단</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {heroLinks.length === 0 ? (
                  <p className="text-muted-foreground">연결된 진단 결과가 없습니다. HERO 웹앱이 설문 완료 시 자동으로 연결됩니다.</p>
                ) : (
                  <ul className="space-y-2">
                    {heroLinks.map((h) => (
                      <li key={h.id} className="rounded-md bg-muted/50 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{h.takenAt ? fmtDateTime(h.takenAt) : fmtDateTime(h.createdAt)}</span>
                          {h.resultUrl ? (
                            <a href={h.resultUrl} target="_blank" rel="noreferrer" className="text-sky-700 underline-offset-4 hover:underline">
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
              <CardHeader className="border-b">
                <CardTitle>파일 (AI 컨설팅 리포트 등)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {files.length === 0 ? (
                  <p className="text-muted-foreground">올린 파일이 없습니다</p>
                ) : (
                  <ul className="divide-y divide-border/70">
                    {files.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                        <span className="rounded-sm bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{FILE_KIND_LABEL[f.kind]}</span>
                        <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="font-medium underline-offset-4 hover:underline">
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
              <CardHeader className="border-b">
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
              <CardHeader className="border-b">
                <CardTitle>상태 변경</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={changeStatusAction} className="flex gap-2">
                  <input type="hidden" name="id" value={member.id} />
                  <select name="status" defaultValue={member.status} className="h-9 flex-1 rounded-lg border border-input bg-card px-3 text-sm">
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
            {transferTo.length ? (
              <Card className="md:col-span-2">
                <CardHeader className="border-b">
                  <CardTitle>지점 이동</CardTitle>
                  <CardDescription>
                    다른 지점으로 옮깁니다. 상담일지·회원 파일·학습진단은 함께 따라가고, 라운딩 체크·식사 주문·정산·이슈는 기록이 남아야 하므로 {ctx.branchName}에 그대로 둡니다. 좌석은 비운 채로 옮기니 받는 지점에서 배정하세요.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <InlineForm action={transferMemberAction} submitLabel="옮기기">
                    <input type="hidden" name="id" value={member.id} />
                    <select name="toBranchId" className="h-9 rounded-lg border border-input bg-card px-3 text-sm" aria-label="옮길 지점">
                      {transferTo.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </InlineForm>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

export default guarded(MemberDetailPage);
