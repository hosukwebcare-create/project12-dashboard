import { redirect } from "next/navigation";
import { needsSetup } from "@/modules/setup/repo";
import { SetupForm } from "./setup-form";

export const metadata = { title: "처음 설정" };
export const dynamic = "force-dynamic";

/** 사용자가 한 명도 없을 때만 열리는 화면. 본사 계정과 첫 지점을 만든다 */
export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8 text-lg font-semibold tracking-tight">Project 12</div>
      <h1 className="text-2xl font-semibold tracking-tight">처음 설정</h1>
      <p className="mt-1 mb-8 text-sm text-muted-foreground">운영 데이터가 비어 있습니다. 본사 관리자 계정을 만들고, 첫 지점을 함께 등록할 수 있습니다. 이 화면은 첫 계정이 생기면 더 이상 열리지 않습니다.</p>
      <SetupForm />
    </main>
  );
}
