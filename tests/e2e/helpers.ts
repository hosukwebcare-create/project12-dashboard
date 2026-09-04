import { expect, type Page } from "@playwright/test";

export const ACCOUNTS = {
  hq: { id: "hq", pw: "hq1234" },
  manager: { id: "manager", pw: "1234" },
  mentor: { id: "mentor", pw: "1234" },
  assistant: { id: "assistant", pw: "1234" },
  manager2: { id: "manager2", pw: "1234" },
} as const;

export async function login(page: Page, who: keyof typeof ACCOUNTS) {
  const acc = ACCOUNTS[who];
  await page.goto("/login");
  await page.getByLabel("아이디").fill(acc.id);
  await page.getByLabel("비밀번호").fill(acc.pw);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
