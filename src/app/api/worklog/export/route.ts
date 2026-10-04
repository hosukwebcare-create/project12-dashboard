import { NextResponse, type NextRequest } from "next/server";
import { tryGetCtx } from "@/lib/auth/ctx";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { monthDates } from "@/lib/rules/meals";
import { formatHours } from "@/lib/rules/worklog";
import { withRequestRls } from "@/lib/rls";
import { monthlySummary } from "@/modules/worklog/repo";

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const ctx = await tryGetCtx();
  if (!ctx) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  try {
    const rows = await withRequestRls(() => monthlySummary(ctx, month));
    // layout=daily: 시트의 근무통계 탭처럼 근무자 × 날짜(칸은 그날 총 근무시간), 맨 끝에 합계
    const daily = req.nextUrl.searchParams.get("layout") === "daily";
    let header: string[];
    let lines: string[];
    if (daily) {
      const dates = monthDates(month);
      header = ["근무자", "근무형태", ...dates.map((d) => `${Number(d.slice(5, 7))}.${Number(d.slice(8))}`), "합계"];
      lines = rows.map((r) => [r.userName, r.employmentType, ...dates.map((d) => (r.byDate[d] ? formatHours(r.byDate[d].x100) : "")), formatHours(r.hoursX100 + r.overtimeX100)].map(csvCell).join(","));
    } else {
      header = ["지점", "월", "근무자", "근무형태", "근무일수", "근무시간", "초과근무", "본사확인시간", "시급", "예상급여"];
      lines = rows.map((r) =>
        [ctx.branchName, month, r.userName, r.employmentType, r.days, formatHours(r.hoursX100), formatHours(r.overtimeX100), formatHours(r.confirmedX100), r.hourlyRate, r.estimatedPay].map(csvCell).join(","),
      );
    }
    const body = "﻿" + [header.join(","), ...lines].join("\r\n");
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        // 헤더에는 ASCII만 허용되므로 한글 이름은 RFC 5987 인코딩으로 붙인다
        "Content-Disposition": `attachment; filename="worklog-${month}${daily ? "-daily" : ""}.csv"; filename*=UTF-8''${encodeURIComponent(`근무${daily ? "통계" : "일지"}-${ctx.branchName}-${month}.csv`)}`,
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
