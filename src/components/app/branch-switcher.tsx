"use client";

import { ChevronsUpDown, MapPin } from "lucide-react";
import { useRef } from "react";

type Props = {
  current: string;
  options: { branchId: string; branchName: string }[];
  action: (formData: FormData) => Promise<void>;
};

export function BranchSwitcher({ current, options, action }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  if (options.length <= 1) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-sm font-medium text-accent-foreground">
        <MapPin className="size-3.5" aria-hidden />
        {options[0]?.branchName}
      </span>
    );
  }
  return (
    <form ref={formRef} action={action} className="relative">
      <MapPin className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-accent-foreground" aria-hidden />
      <select
        name="branchId"
        defaultValue={current}
        aria-label="지점 선택"
        className="h-8 appearance-none rounded-full bg-accent pr-8 pl-8 text-sm font-medium text-accent-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        onChange={() => formRef.current?.requestSubmit()}
      >
        {options.map((o) => (
          <option key={o.branchId} value={o.branchId}>
            {o.branchName}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-accent-foreground/70" aria-hidden />
    </form>
  );
}
