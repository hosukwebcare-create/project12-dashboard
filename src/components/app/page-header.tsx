import type { ReactNode } from "react";

/** 페이지 머리. 제목이 먼저, 보조 정보(지점 · 날짜)는 그 아래 한 줄 */
export function PageHeader({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border pb-4">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight md:text-2xl">{title}</h1>
        {description ? <p className="eyebrow mt-1">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
