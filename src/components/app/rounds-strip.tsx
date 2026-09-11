import { cn } from "@/lib/utils";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 오늘까지 7일의 라운딩 완료 회차. 막대 높이가 그날 완료율, 오늘만 파랗다.
 * 표 대신 이걸 보는 이유: 이번 주 라운딩이 실제로 돌았는지는 숫자 7개보다 막대 7개가 빠르다.
 */
export function RoundsStrip({ days, perDay }: { days: { date: string; done: number }[]; perDay: number }) {
  const max = Math.max(1, perDay);
  return (
    <div className="flex items-end gap-1.5" role="img" aria-label={`지난 7일 라운딩 완료: ${days.map((d) => `${d.done}회`).join(", ")}`}>
      {days.map((d, i) => {
        const today = i === days.length - 1;
        const dow = DOW[new Date(d.date + "T00:00:00").getDay()];
        const h = Math.max(2, Math.round((Math.min(d.done, max) / max) * 28));
        return (
          <div key={d.date} className="flex w-5 flex-col items-center gap-1" title={`${d.date} · ${d.done}/${perDay} 회차`}>
            <div className="flex h-7 w-full items-end">
              <div className={cn("w-full rounded-[2px]", today ? "bg-primary" : d.done === 0 ? "bg-border" : "bg-primary/35")} style={{ height: h }} />
            </div>
            <span className={cn("text-[10px] leading-none", today ? "font-semibold text-foreground" : "text-muted-foreground")}>{dow}</span>
          </div>
        );
      })}
    </div>
  );
}
