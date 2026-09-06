import { CalendarRange, ChevronRight, MapPin, Pencil, Phone, StickyNote } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { formatCustomValue } from "@/components/app/custom-fields";
import { MemberFileUpload } from "@/components/app/member-files";
import { MemberWeekView } from "@/components/app/member-week";
import { SeatAssignForm } from "@/components/app/seat-assign-form";
import { FocusBadge, StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCtx, MANAGER_ROLES, STAFF_ROLES } from "@/lib/auth/ctx";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { guarded } from "@/lib/page-guard";
import { todayKey } from "@/lib/rules/week";
import { cn } from "@/lib/utils";
import { FILE_KIND_LABEL, listMemberFiles } from "@/modules/files/repo";
import { listHeroLinks } from "@/modules/hero/repo";
import { changeStatusAction } from "@/modules/members/actions";
import { getMember, listSeatsWithOccupant, memberTimeline } from "@/modules/members/repo";
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

const TIMELINE_KIND: Record<string, { label: string; dot: string; chip: string }> = {
  penalty: { label: "벌점", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700" },
  issue: { label: "이슈", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800" },
  counsel: { label: "상담", dot: "bg-violet-500", chip: "bg-violet-50 text-violet-700" },
  comment: { label: "코멘트", dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700" },
  audit: { label: "변경", dot: "bg-neutral-400", chip: "bg-muted text-muted-foreground" },
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
  const [timeline, seats, customDefs, files, heroLinks] = await Promise.all([
    memberTimeline(ctx, id),
    canManage ? listSeatsWithOccupant(ctx) : Promise.resolve([]),
    customFieldsFor(ctx, "member"),
    isStaff ? listMemberFiles(ctx, id) : Promise.resolve([]),
    isStaff ? listHeroLinks(ctx, id) : Promise.resolve([]),
  ]);
  const week = member.status === "enrolled" || member.status === "paused" ? await memberWeek(ctx, id, weekParam) : null;

  const kindLabel = `${member.memberKind === "adult" ? "성인" : "학생"}${member.studentType ? ` · ${member.studentType}` : ""}`;
  const schoolLabel = member.school ? `${member.school}${member.grade ? ` ${member.grade}학년` : ""}` : "-";
  const initial = member.name.trim().slice(0, 1);
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
  ];
  const dates: [string, ReactNode][] = [
    ["첫 등록일", fmtDate(member.firstRegisteredAt)],
    ["첫 상담일", fmtDate(member.firstCounseledAt)],
  ];
  const custom: [string, ReactNode][] = customDefs.map((d) => [d.label, formatCustomValue(d, member.custom[d.key])]);

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="eyebrow mb-3 flex items-center gap-1">
        <Link href="/members" className="hover:text-foreground">
          회원
        </Link>
        <ChevronRight className="size-3" aria-hidden />
        <span>{ctx.branchName}</span>
      </nav>

      {/* 히어로: 이름 · 상태 · 좌석 · 핵심 정보 · 등록기간 */}
      <Card className="mb-5 gap-0 py-0">
        <CardContent className="p-5 md:p-6">
          <div className="flex flex-wrap items-start gap-4 md:gap-5">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground shadow-(--shadow-card)" aria-hidden>
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{member.name}</h1>
                <StatusBadge status={member.status} />
                {member.focusCare ? <FocusBadge /> : null}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden />
                  {member.seatNo ? `${member.seatNo}번 좌석 (${member.zone})` : "좌석 미배정"}
                </span>
                <span>{kindLabel}</span>
                {member.school ? <span>{schoolLabel}</span> : null}
                {member.track ? <span>{member.track}</span> : null}
                {showPhone && member.phone ? (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="size-3.5" aria-hidden />
                    {member.phone}
                  </span>
                ) : null}
              </p>
            </div>
            {canManage ? (
              <Button asChild variant="outline">
                <Link href={`/members/${member.id}/edit`}>
                  <Pencil /> 정보 수정
                </Link>
              </Button>
            ) : null}
          </div>

          <div className="mt-5 rounded-xl bg-muted/60 px-4 py-3">
            {enrollment ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <CalendarRange className="size-4 text-muted-foreground" aria-hidden />
                    등록 {fmtDate(enrollment.startDate)} ~ {fmtDate(enrollment.endDate)}
                    {enrollment.planType === "short" ? <span className="rounded-full bg-sky-50 px-1.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-600/15">단기</span> : null}
                  </span>
                  <span className={cn("font-semibold", (member.daysLeft ?? 0) <= 7 ? "text-amber-700" : "text-foreground")}>잔여 {member.daysLeft}일</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
                  <div className={cn("h-full rounded-full", (member.daysLeft ?? 0) <= 7 ? "bg-amber-500" : "bg-primary")} style={{ width: `${enrollPct}%` }} />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">유효한 등록기간 없음</p>
            )}
          </div>

          {member.fieldNote ? (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/15">
              <StickyNote className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
              <span>
                <span className="font-medium">라운딩 특이사항</span> · {member.fieldNote}
              </span>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Tabs defaultValue={sp.week ? "week" : "info"}>
        <TabsList className="pill-nav h-auto rounded-full p-1">
          <TabsTrigger value="info" className="rounded-full px-3 py-1 data-active:shadow-(--shadow-card)">
            기본정보
          </TabsTrigger>
          <TabsTrigger value="timeline" className="rounded-full px-3 py-1 data-active:shadow-(--shadow-card)">
            타임라인 ({timeline.length})
          </TabsTrigger>
          {week ? (
            <TabsTrigger value="week" className="rounded-full px-3 py-1 data-active:shadow-(--shadow-card)">
              라운딩 · 벌점
            </TabsTrigger>
          ) : null}
          {isStaff ? (
            <TabsTrigger value="files" className="rounded-full px-3 py-1 data-active:shadow-(--shadow-card)">
              파일 · 진단 ({files.length + heroLinks.length})
            </TabsTrigger>
          ) : null}
          {canManage ? (
            <TabsTrigger value="manage" className="rounded-full px-3 py-1 data-active:shadow-(--shadow-card)">
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
                  <p className="rounded-xl bg-muted/60 px-4 py-3 text-sm whitespace-pre-wrap">{member.memo}</p>
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
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Phone className="size-3.5" aria-hidden />
                            {g.phone ?? "-"}
                          </span>
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
                        <span className={cn("absolute top-1 -left-[31px] size-2.5 rounded-full ring-4 ring-card", k.dot)} aria-hidden />
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <span className={cn("rounded-full px-1.5 text-[11px] font-semibold", k.chip)}>{k.label}</span>
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
                        {t.body ? <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">{t.body}</p> : null}
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
                      <li key={h.id} className="rounded-xl bg-muted/50 p-3">
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
                        <span className="rounded-full bg-muted px-2 text-[11px] font-medium text-muted-foreground">{FILE_KIND_LABEL[f.kind]}</span>
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
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

export default guarded(MemberDetailPage);
