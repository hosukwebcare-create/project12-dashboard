import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function AccessDenied({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <ShieldAlert className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <h2 className="mt-3 text-lg font-semibold">권한이 없습니다</h2>
      <p className="mt-1 text-sm text-muted-foreground">{message && message !== "권한이 없습니다" ? message : "이 화면을 볼 수 있는 역할이 아닙니다. 지점장이나 본사 관리자에게 문의하세요."}</p>
      <Button asChild variant="outline" className="mt-6">
        <Link href="/">처음으로</Link>
      </Button>
    </div>
  );
}
