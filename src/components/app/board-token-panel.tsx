"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { issueBoardTokenAction } from "@/modules/settings/actions";

export function BoardTokenPanel({ branchId, hasToken }: { branchId: string; hasToken: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const url = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/board/${branchId}?t=${token}` : null;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">{hasToken ? "현재 발급된 링크가 있습니다. 링크는 발급 시 한 번만 표시됩니다." : "아직 발급된 링크가 없습니다."}</p>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await issueBoardTokenAction();
            if (r.error) setError(r.error);
            else setToken(r.token ?? null);
          })
        }
      >
        {pending ? "발급 중…" : hasToken ? "링크 재발급" : "링크 발급"}
      </Button>
      {error ? <p className="text-destructive">{error}</p> : null}
      {url ? (
        <div className="space-y-2 rounded-md border bg-muted/40 p-3">
          <code className="block break-all text-xs">{url}</code>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(url)}>
              복사
            </Button>
            <Button asChild size="sm">
              <a href={url} target="_blank" rel="noreferrer">
                새 창에서 열기
              </a>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
