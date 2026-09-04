import { LoginForm } from "./login-form";

export const metadata = { title: "로그인" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">별하</h1>
          <p className="mt-1 text-sm text-muted-foreground">프로젝트12 통합관리 플랫폼</p>
        </div>
        <LoginForm next={next ?? ""} />
      </div>
    </main>
  );
}
