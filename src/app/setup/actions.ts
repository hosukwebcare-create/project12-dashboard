"use server";

import { redirect } from "next/navigation";
import { toMessage } from "@/lib/action-utils";
import { runSetup } from "@/modules/setup/repo";

export type SetupState = { error?: string };

/** 처음 설정 화면 제출. 사용자가 이미 있으면 저장소 함수가 거부한다 */
export async function setupAction(_prev: SetupState, fd: FormData): Promise<SetupState> {
  const str = (k: string) => String(fd.get(k) ?? "").trim();
  const hqPassword = String(fd.get("hqPassword") ?? "");
  if (hqPassword !== String(fd.get("hqPasswordConfirm") ?? "")) return { error: "본사 비밀번호 확인이 일치하지 않습니다" };
  const withBranch = str("branchCode") !== "" || str("branchName") !== "";
  try {
    await runSetup({
      hqLoginId: str("hqLoginId"),
      hqName: str("hqName"),
      hqPassword,
      branch: withBranch
        ? {
            code: str("branchCode"),
            name: str("branchName"),
            seatCount: Number(str("seatCount") || "0"),
            roundsPerDay: Number(str("roundsPerDay") || "12"),
            managerLoginId: str("managerLoginId") || undefined,
            managerName: str("managerName") || undefined,
            managerPassword: String(fd.get("managerPassword") ?? "") || undefined,
          }
        : null,
    });
  } catch (e) {
    return { error: toMessage(e) };
  }
  redirect("/login?setup=done");
}
