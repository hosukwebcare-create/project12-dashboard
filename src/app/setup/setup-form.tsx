"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setupAction, type SetupState } from "./actions";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, {});
  return (
    <form action={action} className="space-y-10">
      <section>
        <h2 className="border-b border-border pb-2 text-sm font-semibold">본사 관리자</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="hqLoginId" label="아이디" hint="영문·숫자 2~30자">
            <Input id="hqLoginId" name="hqLoginId" defaultValue="hq" autoComplete="username" required />
          </Field>
          <Field id="hqName" label="이름">
            <Input id="hqName" name="hqName" defaultValue="본사운영" required />
          </Field>
          <Field id="hqPassword" label="비밀번호" hint="10자 이상, 영문과 숫자 포함">
            <Input id="hqPassword" name="hqPassword" type="password" autoComplete="new-password" required minLength={10} />
          </Field>
          <Field id="hqPasswordConfirm" label="비밀번호 확인">
            <Input id="hqPasswordConfirm" name="hqPasswordConfirm" type="password" autoComplete="new-password" required minLength={10} />
          </Field>
        </div>
      </section>

      <section>
        <h2 className="border-b border-border pb-2 text-sm font-semibold">
          첫 지점 <span className="ml-1 font-normal text-muted-foreground">선택 · 비워 두면 로그인 후 설정 › 지점 관리에서 만듭니다</span>
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="branchCode" label="지점 코드" hint="영문 대문자·숫자 2~10자 (예: DT2)">
            <Input id="branchCode" name="branchCode" placeholder="DT2" />
          </Field>
          <Field id="branchName" label="지점 이름">
            <Input id="branchName" name="branchName" placeholder="동탄2" />
          </Field>
          <Field id="seatCount" label="좌석 수" hint="1번부터 A구역으로 만들어집니다. 나중에 바꿀 수 있습니다">
            <Input id="seatCount" name="seatCount" type="number" min={0} max={500} defaultValue={50} />
          </Field>
          <Field id="roundsPerDay" label="하루 회차 수">
            <Input id="roundsPerDay" name="roundsPerDay" type="number" min={1} max={24} defaultValue={12} />
          </Field>
          <Field id="managerLoginId" label="지점장 아이디" hint="비워 두면 지점장 없이 지점만 만듭니다">
            <Input id="managerLoginId" name="managerLoginId" autoComplete="off" />
          </Field>
          <Field id="managerName" label="지점장 이름">
            <Input id="managerName" name="managerName" />
          </Field>
          <Field id="managerPassword" label="지점장 비밀번호" hint="10자 이상, 영문과 숫자 포함">
            <Input id="managerPassword" name="managerPassword" type="password" autoComplete="new-password" />
          </Field>
        </div>
      </section>

      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "만드는 중…" : "설정 완료"}
      </Button>
    </form>
  );
}
