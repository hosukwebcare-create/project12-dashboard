import Link from "next/link";
import { AlimtalkComposer } from "@/components/app/alimtalk-composer";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { getCtx, MANAGER_ROLES, requireRole } from "@/lib/auth/ctx";
import { guarded } from "@/lib/page-guard";
import { getProvider } from "@/modules/alimtalk/provider";
import { buildRecipients, listTemplates } from "@/modules/alimtalk/repo";

export const metadata = { title: "알림톡" };

async function AlimtalkPage() {
  const ctx = await getCtx();
  requireRole(ctx, ...MANAGER_ROLES);
  const [templates, memberRecipients, guardianRecipients] = await Promise.all([
    listTemplates(ctx),
    buildRecipients(ctx, { group: "all", recipientType: "member" }),
    buildRecipients(ctx, { group: "all", recipientType: "guardian" }),
  ]);
  const gPhone = new Map(guardianRecipients.map((r) => [r.memberId, Boolean(r.phone)]));
  const focusIds = new Set((await buildRecipients(ctx, { group: "focus", recipientType: "member" })).map((r) => r.memberId));
  const members = memberRecipients.map((r) => ({ id: r.memberId, name: r.name, seatNo: r.seatNo, focusCare: focusIds.has(r.memberId), hasPhone: Boolean(r.phone), hasGuardianPhone: gPhone.get(r.memberId) ?? false }));
  let providerName = "mock";
  try {
    providerName = getProvider().name;
  } catch {
    providerName = "미설정";
  }
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="카카오 알림톡"
        description={`${ctx.branchName} · 주간리포트 안내·공지 발송`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/alimtalk/history">발송 이력</Link>
          </Button>
        }
      />
      <AlimtalkComposer templates={templates.map((t) => ({ id: t.id, name: t.name, body: t.body, variables: t.variables }))} members={members} branchName={ctx.branchName} providerName={providerName} />
    </div>
  );
}

export default guarded(AlimtalkPage);
