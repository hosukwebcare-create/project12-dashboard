import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CustomFieldDef } from "@/modules/settings/repo";

const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";

/** 정의 목록을 폼 필드로 렌더링한다. name은 `custom.<key>` */
export function CustomFields({ defs, values, className }: { defs: CustomFieldDef[]; values: Record<string, unknown>; className?: string }) {
  if (defs.length === 0) return null;
  return (
    <div className={cn("grid gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {defs.map((d) => {
        const id = `custom.${d.key}`;
        const v = values[d.key];
        const label = (
          <Label htmlFor={id} className="mb-1.5 block">
            {d.label}
            {d.required ? (
              <span aria-hidden="true" className="text-destructive">
                {" "}
                *
              </span>
            ) : null}
          </Label>
        );
        switch (d.type) {
          case "boolean":
            return (
              <div key={d.key} className="flex items-center gap-2 pt-6">
                <input id={id} name={id} type="checkbox" className="size-4" defaultChecked={Boolean(v)} />
                <Label htmlFor={id}>{d.label}</Label>
              </div>
            );
          case "select":
            return (
              <div key={d.key}>
                {label}
                <select id={id} name={id} defaultValue={typeof v === "string" ? v : ""} className={selectClass} required={d.required}>
                  <option value="">선택</option>
                  {d.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            );
          case "multiselect": {
            const selected = Array.isArray(v) ? (v as string[]) : [];
            return (
              <div key={d.key}>
                {label}
                <div className="flex flex-wrap gap-3 pt-1">
                  {d.options.map((o) => (
                    <label key={o} className="flex items-center gap-1 text-sm">
                      <input type="checkbox" name={id} value={o} defaultChecked={selected.includes(o)} className="size-4" />
                      {o}
                    </label>
                  ))}
                </div>
              </div>
            );
          }
          case "number":
            return (
              <div key={d.key}>
                {label}
                <Input id={id} name={id} type="number" step="any" defaultValue={typeof v === "number" ? v : ""} required={d.required} />
              </div>
            );
          case "date":
            return (
              <div key={d.key}>
                {label}
                <Input id={id} name={id} type="date" defaultValue={typeof v === "string" ? v : ""} required={d.required} />
              </div>
            );
          default:
            return (
              <div key={d.key}>
                {label}
                <Input id={id} name={id} defaultValue={typeof v === "string" ? v : ""} required={d.required} />
              </div>
            );
        }
      })}
    </div>
  );
}

export function formatCustomValue(d: CustomFieldDef, v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  if (d.type === "boolean") return v ? "예" : "아니오";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
