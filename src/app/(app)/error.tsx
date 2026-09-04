"use client";

import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const message = error.name === "ForbiddenError" ? "이 화면을 볼 권한이 없습니다" : error.name === "NotFoundError" ? "요청한 항목을 찾을 수 없습니다" : "문제가 발생했습니다";
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h2 className="text-lg font-semibold">{message}</h2>
      {process.env.NODE_ENV !== "production" ? <p className="mt-2 text-sm text-muted-foreground">{error.message}</p> : null}
      <Button className="mt-6" variant="outline" onClick={reset}>
        다시 시도
      </Button>
    </div>
  );
}
