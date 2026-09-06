import type { ReactNode } from "react";

/**
 * 페이지 머리. description 은 "지점 · 날짜 · 부가정보" 처럼 눈썹 텍스트로 제목 위에 놓인다.
 */
export function PageHeader({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-border/70 pb-4">
      <div className="min-w-0">
        {description ? <p className="eyebrow mb-1">{description}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[26px]">{title}</h1>
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
