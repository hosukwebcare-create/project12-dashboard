import { z } from "zod";

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const optText = (max = 200) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional();
const optDate = () => z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식은 YYYY-MM-DD 입니다").nullable()).optional();
const phone = () =>
  z.preprocess(emptyToNull, z.string().trim().regex(/^01[016789]-?\d{3,4}-?\d{4}$/, "연락처 형식이 올바르지 않습니다").nullable()).optional();

export const MEMBER_STATUSES = ["prospect", "enrolled", "paused", "withdrawn"] as const;
export const STATUS_LABEL: Record<(typeof MEMBER_STATUSES)[number], string> = {
  prospect: "상담",
  enrolled: "등록",
  paused: "휴원",
  withdrawn: "퇴원",
};
export const TRACKS = ["문과", "이과", "예체능"] as const;
export const STUDENT_TYPES = ["재학생", "N수생", "검정고시", "기타"] as const;

export const memberInputSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요").max(30, "이름은 30자 이내"),
  phone: phone(),
  birthDate: optDate(),
  gender: optText(4),
  memberKind: z.enum(["student", "adult"]).default("student"),
  studentType: optText(20),
  school: optText(50),
  grade: optText(10),
  track: optText(10),
  target: optText(100),
  address: optText(200),
  status: z.enum(MEMBER_STATUSES).default("prospect"),
  focusCare: z.coerce.boolean().default(false),
  seatId: z.preprocess(emptyToNull, z.string().uuid().nullable()).optional(),
  firstRegisteredAt: optDate(),
  firstCounseledAt: optDate(),
  /** 동의·거부·미확인 세 값. 빈 문자열은 미확인(null) 이다 */
  marketingOptIn: z.preprocess((v) => (v === "" || v === undefined || v === null ? null : v === "true" || v === true), z.boolean().nullable()).optional(),
  memo: optText(2000),
  fieldNote: optText(100),
  guardian: z
    .object({ name: optText(30), relation: optText(10), phone: phone() })
    .nullable()
    .optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
  enrollment: z
    .object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "시작일 형식"),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "종료일 형식"),
      planType: z.enum(["regular", "short"]).default("regular"),
      note: optText(100),
    })
    .nullable()
    .optional()
    .refine((e) => !e || e.startDate <= e.endDate, { message: "종료일은 시작일 이후여야 합니다" }),
});

export type MemberInput = z.input<typeof memberInputSchema>;
export type MemberInputParsed = z.output<typeof memberInputSchema>;

/** FormData → 중첩 객체 (guardian.name, enrollment.startDate 같은 점 표기 지원) */
export function formToMemberInput(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Array.from(new Set(Array.from(fd.keys())));
  for (const key of keys) {
    const all = fd.getAll(key).filter((v): v is string => typeof v === "string");
    if (all.length === 0) continue;
    const value: string | string[] = all.length > 1 ? all : all[0];
    const parts = key.split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] ??= {};
      cur = cur[parts[i]] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
  }
  // 체크박스는 체크했을 때만 전송된다
  out.focusCare = fd.get("focusCare") === "on" || fd.get("focusCare") === "true";
  const e = out.enrollment as Record<string, unknown> | undefined;
  if (e && !e.startDate && !e.endDate) out.enrollment = null;
  return out;
}
