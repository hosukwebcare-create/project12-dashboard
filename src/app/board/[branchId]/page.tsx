import { BoardGrid } from "@/components/app/board-grid";
import { todayKey } from "@/lib/rules/week";
import { boardData, verifyBoardToken } from "@/modules/board/repo";

export const metadata = { title: "생활관리 현황판" };
export const dynamic = "force-dynamic";

export default async function BoardPage({ params, searchParams }: { params: Promise<{ branchId: string }>; searchParams: Promise<{ t?: string; week?: string }> }) {
  const { branchId } = await params;
  const { t, week } = await searchParams;
  if (!(await verifyBoardToken(branchId, t))) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">현황판 접근 토큰이 올바르지 않습니다</h1>
          <p className="mt-2 text-sm text-neutral-500">지점 설정에서 현황판 링크를 다시 발급받아 주세요.</p>
        </div>
      </main>
    );
  }
  const data = await boardData(branchId, week ?? todayKey());
  return (
    <main className="min-h-screen bg-white p-2">
      <BoardGrid branchId={branchId} token={t!} initial={data} />
    </main>
  );
}
