import type { Metadata, Viewport } from "next";
import "./globals.css";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { default: "Project 12 통합관리", template: "%s · Project 12" },
  description: "관리형 스터디카페 통합관리 플랫폼",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f7f6f2",
};

/**
 * 본문 서체는 Pretendard Variable (한글·라틴 모두 정돈된 가변 서체). CDN 을 못 쓰는 폐쇄망에서는 시스템 서체로 자연스럽게 떨어진다.
 */
const FONT_STACK = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", Roboto, "Noto Sans KR", "Malgun Gothic", sans-serif';

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={cn("h-full antialiased", "font-sans")} style={{ ["--font-sans" as string]: FONT_STACK }}>
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
