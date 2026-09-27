import { redirect } from "next/navigation";

/** 일별 체크는 라운딩 하루 표의 열(플래너·영단어·점검완료)로 옮겼다. 같은 명단을 두 번 돌지 않도록 */
export default async function DailyChecksRedirect({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  redirect(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `/rounding?date=${date}` : "/rounding");
}
