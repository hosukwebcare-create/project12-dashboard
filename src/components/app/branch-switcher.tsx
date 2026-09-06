"use client";

import { ChevronDown } from "lucide-react";
import { useRef } from "react";

type Props = {
  current: string;
  options: { branchId: string; branchName: string }[];
  action: (formData: FormData) => Promise<void>;
};

/** 지점 표시·전환. 지점이 하나면 글자만, 여러 개면 얇은 선택 상자 */
export function BranchSwitcher({ current, options, action }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  if (options.length <= 1) {
    return <span className="border-l border-border pl-4 text-sm text-muted-foreground">{options[0]?.branchName}</span>;
  }
  return (
    <form ref={formRef} action={action} className="relative border-l border-border pl-3">
      <select
        name="branchId"
        defaultValue={current}
        aria-label="지점 선택"
        className="h-8 appearance-none rounded-md bg-transparent pr-7 pl-1 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
        onChange={() => formRef.current?.requestSubmit()}
      >
        {options.map((o) => (
          <option key={o.branchId} value={o.branchId}>
            {o.branchName}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </form>
  );
}
