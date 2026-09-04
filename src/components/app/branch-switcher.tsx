"use client";

import { useRef } from "react";

type Props = {
  current: string;
  options: { branchId: string; branchName: string }[];
  action: (formData: FormData) => Promise<void>;
};

export function BranchSwitcher({ current, options, action }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  if (options.length <= 1) {
    return <span className="text-sm font-medium">{options[0]?.branchName}</span>;
  }
  return (
    <form ref={formRef} action={action}>
      <select
        name="branchId"
        defaultValue={current}
        aria-label="지점 선택"
        className="h-8 rounded-md border bg-background px-2 text-sm"
        onChange={() => formRef.current?.requestSubmit()}
      >
        {options.map((o) => (
          <option key={o.branchId} value={o.branchId}>
            {o.branchName}
          </option>
        ))}
      </select>
    </form>
  );
}
