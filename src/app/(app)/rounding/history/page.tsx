import { redirect } from "next/navigation";

/** 라운딩 조회는 하루 표가 대신한다. 날짜를 넘기면 그날 표를 연다 */
export default async function RoundingHistoryRedirect({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  redirect(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `/rounding?date=${date}` : "/rounding");
}
