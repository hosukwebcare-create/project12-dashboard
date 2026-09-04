import { and, eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db/client";
import { members, seats, type MemberStatus } from "@/db/schema";
import { MANAGER_ROLES, requireRole, type Ctx } from "@/lib/auth/ctx";
import { normalizeBool, normalizeDate, normalizePhone, parsePeriod, splitNameSuffix, splitSchoolGrade } from "@/lib/rules/import-parsers";
import { createMember, getMember, updateMember } from "./repo";
import { STATUS_LABEL, TRACKS } from "./schema";

export type ImportField =
  | "seatNo"
  | "name"
  | "phone"
  | "birthDate"
  | "gender"
  | "memberKind"
  | "studentType"
  | "focusCare"
  | "target"
  | "schoolGrade"
  | "school"
  | "grade"
  | "track"
  | "address"
  | "guardianName"
  | "guardianPhone"
  | "period"
  | "enrollStart"
  | "enrollEnd"
  | "status"
  | "memo"
  | "fieldNote";

export const IMPORT_FIELDS: { key: ImportField; label: string; aliases: string[] }[] = [
  { key: "seatNo", label: "좌석번호", aliases: ["좌석번호", "좌석", "seat"] },
  { key: "name", label: "이름", aliases: ["성명", "이름", "회원명", "name"] },
  { key: "phone", label: "연락처", aliases: ["연락처", "전화번호", "전화", "휴대폰", "phone"] },
  { key: "birthDate", label: "생년월일", aliases: ["생년월일", "생일", "birth"] },
  { key: "gender", label: "성별", aliases: ["성별", "gender"] },
  { key: "memberKind", label: "구분(학생/성인)", aliases: ["구분", "kind"] },
  { key: "studentType", label: "TYPE", aliases: ["type", "유형", "학생유형"] },
  { key: "focusCare", label: "집중관리", aliases: ["집중관리", "집중"] },
  { key: "target", label: "목표", aliases: ["목표대학/학과/시험", "목표", "목표대학", "target"] },
  { key: "schoolGrade", label: "학교명/학년", aliases: ["학교명/학년", "학교/학년", "학교학년"] },
  { key: "school", label: "학교", aliases: ["학교명", "학교", "school"] },
  { key: "grade", label: "학년", aliases: ["학년", "grade"] },
  { key: "track", label: "계열", aliases: ["계열", "track"] },
  { key: "address", label: "주소", aliases: ["주소", "address"] },
  { key: "guardianName", label: "학부모 이름", aliases: ["학부모 이름", "학부모명", "보호자 이름", "보호자명"] },
  { key: "guardianPhone", label: "학부모 연락처", aliases: ["학부모 연락처", "학부모연락처", "보호자 연락처", "학부모", "보호자"] },
  { key: "period", label: "등록기간(표기)", aliases: ["등록기간", "기간", "등록 기간"] },
  { key: "enrollStart", label: "등록 시작일", aliases: ["등록시작", "시작일", "등록 시작일"] },
  { key: "enrollEnd", label: "등록 종료일", aliases: ["등록종료", "종료일", "등록 종료일", "만료일"] },
  { key: "status", label: "상태", aliases: ["상태", "status"] },
  { key: "memo", label: "메모", aliases: ["메모", "비고", "memo"] },
  { key: "fieldNote", label: "라운딩 특이사항", aliases: ["특이사항", "라운딩 특이사항"] },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

export function autoMapHeaders(headers: string[]): Record<number, ImportField | null> {
  const out: Record<number, ImportField | null> = {};
  const used = new Set<ImportField>();
  headers.forEach((h, i) => {
    const n = norm(h);
    let found: ImportField | null = null;
    for (const f of IMPORT_FIELDS) {
      if (used.has(f.key)) continue;
      if (f.aliases.some((a) => norm(a) === n)) {
        found = f.key;
        break;
      }
    }
    if (found) used.add(found);
    out[i] = found;
  });
  return out;
}

export type ImportRow = {
  row: number;
  name: string;
  seatNo: number | null;
  phone: string | null;
  birthDate: string | null;
  gender: string | null;
  memberKind: "student" | "adult";
  studentType: string | null;
  focusCare: boolean;
  target: string | null;
  school: string | null;
  grade: string | null;
  track: string | null;
  address: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  planType: "regular" | "short";
  enrollStart: string | null;
  enrollEnd: string | null;
  status: MemberStatus;
  memo: string | null;
  fieldNote: string | null;
  existingId?: string;
};

export type ImportMessage = { row: number; message: string };
export type ImportPreview = { rows: ImportRow[]; errors: ImportMessage[]; warnings: ImportMessage[] };

const STATUS_BY_LABEL: Record<string, MemberStatus> = Object.fromEntries(Object.entries(STATUS_LABEL).map(([k, v]) => [v, k as MemberStatus]));

export async function previewImport(ctx: Ctx, data: string[][], mapping: Record<number, ImportField | null>, today: string, db: Db = defaultDb): Promise<ImportPreview> {
  requireRole(ctx, ...MANAGER_ROLES);
  const errors: ImportMessage[] = [];
  const warnings: ImportMessage[] = [];
  const rows: ImportRow[] = [];

  const branchSeats = await db.select().from(seats).where(eq(seats.branchId, ctx.branchId));
  const seatByNo = new Map(branchSeats.map((s) => [s.seatNo, s]));
  const existing = await db
    .select({ id: members.id, name: members.name, phone: members.phone, status: members.status, seatNo: seats.seatNo })
    .from(members)
    .leftJoin(seats, eq(seats.id, members.seatId))
    .where(eq(members.branchId, ctx.branchId));
  const seenSeats = new Map<number, number>();

  data.slice(1).forEach((cells, idx) => {
    const rowNo = idx + 2;
    const get = (f: ImportField) => {
      const col = Object.entries(mapping).find(([, v]) => v === f)?.[0];
      return col === undefined ? "" : (cells[Number(col)] ?? "").trim();
    };
    if (cells.every((c) => c.trim() === "")) return;

    const { name, short } = splitNameSuffix(get("name"));
    const sg = splitSchoolGrade(get("schoolGrade"));
    const school = get("school") || sg.school;
    const grade = get("grade") || sg.grade;
    const kindRaw = get("memberKind");
    const memberKind: "student" | "adult" = /성인|adult/i.test(kindRaw) ? "adult" : "student";
    const trackRaw = get("track");
    const track = (TRACKS as readonly string[]).includes(trackRaw) ? trackRaw : null;
    if (trackRaw && !track) warnings.push({ row: rowNo, message: `계열 '${trackRaw}'은(는) 문과/이과/예체능이 아니라 비웠습니다` });
    const period = parsePeriod(get("period"), today);
    const enrollStart = normalizeDate(get("enrollStart")) ?? period?.startDate ?? null;
    const enrollEnd = normalizeDate(get("enrollEnd")) ?? period?.endDate ?? null;
    const seatRaw = get("seatNo");
    let seatNo: number | null = seatRaw ? Number(seatRaw) : null;
    if (seatRaw && !Number.isInteger(seatNo)) {
      warnings.push({ row: rowNo, message: `좌석번호 '${seatRaw}'을(를) 읽을 수 없어 비웠습니다` });
      seatNo = null;
    }
    const statusRaw = get("status");
    let status: MemberStatus = statusRaw && STATUS_BY_LABEL[statusRaw] ? STATUS_BY_LABEL[statusRaw] : seatNo ? "enrolled" : "prospect";

    const phone = normalizePhone(get("phone"));
    const r: ImportRow = {
      row: rowNo,
      name,
      seatNo,
      phone,
      birthDate: normalizeDate(get("birthDate")),
      gender: get("gender") || null,
      memberKind,
      studentType: get("studentType") || null,
      focusCare: normalizeBool(get("focusCare")),
      target: get("target") || null,
      school,
      grade,
      track,
      address: get("address") || null,
      guardianName: get("guardianName") || null,
      guardianPhone: normalizePhone(get("guardianPhone")),
      planType: short ? "short" : "regular",
      enrollStart,
      enrollEnd,
      status,
      memo: get("memo") || null,
      fieldNote: get("fieldNote") || null,
    };

    if (!name) errors.push({ row: rowNo, message: "이름이 없습니다" });
    if (get("birthDate") && !r.birthDate) warnings.push({ row: rowNo, message: `생년월일 '${get("birthDate")}' 형식을 읽을 수 없어 비웠습니다` });
    if (phone && !/^01[016789]-\d{3,4}-\d{4}$/.test(phone)) warnings.push({ row: rowNo, message: `연락처 '${phone}' 형식을 확인하세요` });

    if (seatNo !== null) {
      const seat = seatByNo.get(seatNo);
      const dupRow = seenSeats.get(seatNo);
      const occupant = existing.find((m) => m.seatNo === seatNo && m.status === "enrolled");
      if (!seat) {
        errors.push({ row: rowNo, message: `${seatNo}번 좌석이 지점에 없습니다 (설정 › 좌석에서 먼저 추가)` });
        seatNo = null;
      } else if (dupRow) {
        errors.push({ row: rowNo, message: `좌석 ${seatNo}번이 ${dupRow}행과 중복됩니다` });
        seatNo = null;
      } else if (occupant && occupant.name !== name) {
        errors.push({ row: rowNo, message: `${seatNo}번 좌석은 ${occupant.name}이(가) 사용 중입니다` });
        seatNo = null;
      } else {
        seenSeats.set(seatNo, rowNo);
      }
      if (seatNo === null) {
        r.seatNo = null;
        status = statusRaw && STATUS_BY_LABEL[statusRaw] ? STATUS_BY_LABEL[statusRaw] : "prospect";
        r.status = status;
      }
    }

    const match = existing.find((m) => m.name === name && ((r.seatNo !== null && m.seatNo === r.seatNo) || (phone && m.phone === phone)));
    if (match) {
      r.existingId = match.id;
      warnings.push({ row: rowNo, message: `${name}: 기존 회원과 일치하여 정보를 갱신합니다` });
    }
    rows.push(r);
  });

  return { rows, errors, warnings };
}

export async function commitImport(ctx: Ctx, rows: ImportRow[], db: Db = defaultDb): Promise<{ created: number; updated: number }> {
  requireRole(ctx, ...MANAGER_ROLES);
  const branchSeats = await db.select().from(seats).where(eq(seats.branchId, ctx.branchId));
  const seatByNo = new Map(branchSeats.map((s) => [s.seatNo, s.id]));
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const guardian = r.guardianName || r.guardianPhone ? { name: r.guardianName, relation: null, phone: r.guardianPhone } : null;
    const enrollment = r.enrollStart && r.enrollEnd ? { startDate: r.enrollStart, endDate: r.enrollEnd, planType: r.planType, note: r.planType === "short" ? "단기(이관)" : null } : null;
    const base = {
      name: r.name,
      phone: r.phone,
      birthDate: r.birthDate,
      gender: r.gender,
      memberKind: r.memberKind,
      studentType: r.studentType,
      school: r.school,
      grade: r.grade,
      track: r.track,
      target: r.target,
      address: r.address,
      focusCare: r.focusCare,
      memo: r.memo,
      fieldNote: r.fieldNote,
      guardian,
      enrollment,
    };
    if (r.existingId) {
      const cur = await getMember(ctx, r.existingId, db);
      await updateMember(
        ctx,
        r.existingId,
        {
          ...base,
          phone: r.phone ?? cur.phone,
          birthDate: r.birthDate ?? cur.birthDate,
          gender: r.gender ?? cur.gender,
          studentType: r.studentType ?? cur.studentType,
          school: r.school ?? cur.school,
          grade: r.grade ?? cur.grade,
          track: r.track ?? cur.track,
          target: r.target ?? cur.target,
          address: r.address ?? cur.address,
          memo: r.memo ?? cur.memo,
          fieldNote: r.fieldNote ?? cur.fieldNote,
          status: cur.status,
        },
        db,
      );
      updated++;
    } else {
      await createMember(ctx, { ...base, status: r.status, seatId: r.seatNo !== null ? (seatByNo.get(r.seatNo) ?? null) : null }, db);
      created++;
    }
  }
  return { created, updated };
}

/** 지점의 기존 회원 중 이름·좌석이 같은 회원 (미리보기 표시용) */
export async function findMemberByNameSeat(ctx: Ctx, name: string, seatNo: number | null, db: Db = defaultDb) {
  const rows = await db
    .select({ id: members.id })
    .from(members)
    .leftJoin(seats, eq(seats.id, members.seatId))
    .where(and(eq(members.branchId, ctx.branchId), eq(members.name, name)));
  void seatNo;
  return rows[0]?.id ?? null;
}
