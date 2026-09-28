"use server";

import { withRequestRls } from "@/lib/rls";
import { toMessage } from "@/lib/action-utils";
import { getCtx } from "@/lib/auth/ctx";
import { clearCheck, completeRound, copyPreviousRound, dayCells, fillRemaining, saveCell, type CellPatch, type CheckInput, type DayCell, type SessionSummary } from "./repo";

type CellKeyInput = { memberId: string; date: string; itemKey: string; roundNo: number };

/** 칸 하나 적기. 적은 칸과 그 때문에 바뀐 출석 칸을 돌려준다 */
export async function saveCellAction(input: CheckInput): Promise<{ patch?: CellPatch; error?: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      return { patch: await saveCell(ctx, input) };
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}

/** 지우개 */
export async function clearCellAction(input: CellKeyInput): Promise<{ patch?: CellPatch; error?: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      return { patch: await clearCheck(ctx, input) };
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}

/** 직전 회차 값 가져오기 */
export async function copyPreviousRoundAction(input: { date: string; roundNo: number }): Promise<{ patch?: CellPatch; error?: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      return { patch: await copyPreviousRound(ctx, input.date, input.roundNo) };
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}

/**
 * 회차 완료: 빈 칸 a 로 채우고 완료 표시. 표는 돌려받은 칸으로 고치므로 화면을 다시 그리지 않는다
 * (revalidatePath 를 부르면 지금 보고 있는 하루 표 전체를 서버에서 다시 그려 보낸다).
 */
export async function completeRoundAction(input: { date: string; roundNo: number }): Promise<{ patch?: CellPatch; summary?: SessionSummary; error?: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      return await completeRound(ctx, input.date, input.roundNo);
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}

/** 일별 항목의 빈 칸을 a 로 채우기. 실제로 채운 칸만 돌려준다 */
export async function fillRemainingAction(input: { date: string; itemKey: string }): Promise<{ patch?: CellPatch; error?: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      return { patch: await fillRemaining(ctx, input.date, input.itemKey) };
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}

/** 하루 표 새로 읽기(다른 기기가 적은 것 따라가기). 읽기만 하므로 멘토도 된다 */
export async function dayCellsAction(input: { date: string }): Promise<{ cells?: Record<string, DayCell>; completedRounds?: number[]; error?: string }> {
  return withRequestRls(async () => {
    const ctx = await getCtx();
    try {
      return await dayCells(ctx, input.date);
    } catch (e) {
      return { error: toMessage(e) };
    }
  });
}
