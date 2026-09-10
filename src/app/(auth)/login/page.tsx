import { redirect } from "next/navigation";
import { needsSetup } from "@/modules/setup/repo";
import { LoginForm } from "./login-form";

export const metadata = { title: "로그인" };

const POINTS = [
  { title: "라운딩은 예외만", body: "모든 회원은 양호가 기본. 태블릿에서 벌점과 부재만 누르면 현황판까지 한 번에 반영됩니다." },
  { title: "지점마다 분리, 본사는 한눈에", body: "지점 데이터는 서로 보이지 않고, 본사는 전 지점 요약을 한 화면에서 봅니다." },
  { title: "시트에서 그대로", body: "쓰던 구글시트를 붙여 넣으면 회원, 좌석, 등록기간이 자동으로 정리됩니다." },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; setup?: string }> }) {
  const { next, setup } = await searchParams;
  if (await needsSetup()) redirect("/setup");
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* 왼쪽 소개 패널은 흰 바탕이다. 예전 어두운 패널 시절의 text-white 를 그대로 두면 글씨가 사라진다. */}
      <section className="hidden border-r border-border bg-card text-card-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="text-lg font-semibold tracking-tight">Project 12</div>
        <div className="max-w-md">
          <p className="text-sm text-muted-foreground">통합관리 플랫폼</p>
          <h2 className="mt-3 text-[32px] leading-[1.25] font-semibold tracking-tight">
            흩어진 시트를 하나로,
            <br />
            현장은 더 가볍게.
          </h2>
          <ul className="mt-10 divide-y divide-border border-y border-border">
            {POINTS.map((p) => (
              <li key={p.title} className="py-4">
                <p className="font-medium">{p.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">관리형 스터디카페 체인 · 회원 · 상담 · 라운딩 · 식사 · 근무</p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-lg font-semibold tracking-tight lg:hidden">Project 12</div>
          <h1 className="text-2xl font-semibold tracking-tight">로그인</h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">{setup === "done" ? "처음 설정이 끝났습니다. 방금 만든 본사 계정으로 들어가세요." : "지점에서 받은 계정으로 들어갑니다."}</p>
          <LoginForm next={next ?? ""} />
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">비밀번호를 5회 틀리면 10분간 잠깁니다. 잊었다면 지점장에게 재설정을 요청하세요.</p>
        </div>
      </section>
    </main>
  );
}
