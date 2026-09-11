import type { ReactNode } from "react";

/** 페이지 머리. 제목과 보조 정보(지점 · 날짜)가 한 줄, 아래 경계선 하나 */
export function PageHeader({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-border pb-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[20px] leading-tight font-bold tracking-tight">{title}</h1>
        {description ? <p className="eyebrow text-[13px]">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
