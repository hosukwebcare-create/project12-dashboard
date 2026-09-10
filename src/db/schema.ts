import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------- 공용 타입 ----------
export type BranchRole = "branch_manager" | "mentor" | "assistant";
export type MemberStatus = "prospect" | "enrolled" | "paused" | "withdrawn";
export type MemberKind = "student" | "adult";
export type Grade = "a" | "b" | "p" | "na";
export type IssueStatus = "open" | "in_progress" | "resolved";
export type CounselLogType = "weekly" | "focus_daily";
export type BoardItemKind = "daily" | "round";
export type BranchSettings = {
  roundsPerDay: number;
  maskNames: boolean;
  /** 회차별 시작 시각 "HH:mm" (선택) */
  roundSchedule?: string[];
};

const DEFAULT_BRANCH_SETTINGS: BranchSettings = { roundsPerDay: 12, maskNames: false };


/**
 * 지점 격리 RLS 정책. 앱이 요청 트랜잭션에 app.rls='on' 과 app.branch_id 를 설정했을 때만 검사한다(withRls).
 * 컨텍스트가 없는 경로(로그인, 배치, 마이그레이션)는 통과하고, 본사 관리자(app.is_hq='true')는 전체를 본다.
 * nullable 지점 컬럼(본사 기본값 행)은 null 이면 모두에게 보인다.
 */
function branchRls(table: string, col: AnyPgColumn, nullable = false) {
  const scoped = sql`current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or ${col} = nullif(current_setting('app.branch_id', true), '')::uuid`;
  return pgPolicy(`${table}_branch_rls`, { for: "all", to: "public", using: nullable ? sql`${col} is null or (${scoped})` : scoped });
}

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------- 조직 ----------
export const branches = pgTable("branches", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  /** 점주(가맹주) 이름. 근무하는 지점장과는 별개이고 한 사람이 여러 지점을 가질 수 있다 */
  ownerName: text("owner_name"),
  settings: jsonb("settings").$type<BranchSettings>().notNull().default(DEFAULT_BRANCH_SETTINGS),
  boardTokenHash: text("board_token_hash"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable("users", {
  id: id(),
  loginId: text("login_id").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  pinHash: text("pin_hash"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  /** 이 시각보다 먼저 발급된 세션 토큰은 무효로 본다 (비밀번호를 바꾸면 로그인된 기기가 모두 풀린다) */
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  isHqAdmin: boolean("is_hq_admin").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    role: text("role").$type<BranchRole>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] })],
);

export const seats = pgTable(
  "seats",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    seatNo: integer("seat_no").notNull(),
    zone: text("zone").notNull().default("A"),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
    /** 좌석 등급(요금표). 결제 금액은 이 등급과 회원 구분(학생/성인)으로 정해진다 */
    feePlanId: uuid("fee_plan_id"),
  },
  (t) => [branchRls("seats", t.branchId), uniqueIndex("seats_branch_seat_no_uq").on(t.branchId, t.seatNo)],
).enableRLS();

// ---------- 회원 마스터 ----------
export const members = pgTable(
  "members",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    seatId: uuid("seat_id").references(() => seats.id),
    name: text("name").notNull(),
    phone: text("phone"),
    birthDate: date("birth_date"),
    gender: text("gender"),
    memberKind: text("member_kind").$type<MemberKind>().notNull().default("student"),
    studentType: text("student_type"),
    school: text("school"),
    grade: text("grade"),
    track: text("track"),
    target: text("target"),
    address: text("address"),
    status: text("status").$type<MemberStatus>().notNull().default("prospect"),
    focusCare: boolean("focus_care").notNull().default(false),
    firstRegisteredAt: date("first_registered_at"),
    firstCounseledAt: date("first_counseled_at"),
    /** 마케팅 문자·알림 수신 동의. null 은 아직 받지 않은 것(동의 거부와 구분한다) */
    marketingOptIn: boolean("marketing_opt_in"),
    memo: text("memo"),
    /** 라운딩 목록에 항상 표시되는 짧은 특이사항 */
    fieldNote: text("field_note"),
    custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
    /** 퇴원 처리일. 보관기간 계산 기준 */
    withdrawnAt: date("withdrawn_at"),
    /** 개인정보 익명화 시각 */
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    branchRls("members", t.branchId),
    uniqueIndex("members_seat_enrolled_uq")
      .on(t.seatId)
      .where(sql`${t.status} = 'enrolled' and ${t.seatId} is not null`),
    index("members_branch_status_idx").on(t.branchId, t.status),
  ],
).enableRLS();

export const memberEnrollments = pgTable("member_enrollments", {
  id: id(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  planType: text("plan_type").notNull().default("regular"),
  note: text("note"),
  createdAt: createdAt(),
}, (t) => [index("member_enrollments_member_idx").on(t.memberId, t.startDate)]);

export const memberGuardians = pgTable("member_guardians", {
  id: id(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  name: text("name"),
  relation: text("relation"),
  phone: text("phone"),
  primaryContact: boolean("primary_contact").notNull().default(true),
}, (t) => [index("member_guardians_member_idx").on(t.memberId)]);

export const mockExamRounds = pgTable(
  "mock_exam_rounds",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    yearMonth: text("year_month").notNull(),
    name: text("name").notNull(),
    price: integer("price").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [branchRls("mock_exam_rounds", t.branchId), uniqueIndex("mock_exam_rounds_uq").on(t.branchId, t.yearMonth, t.name)],
).enableRLS();

export const mockExamApplications = pgTable(
  "mock_exam_applications",
  {
    id: id(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => mockExamRounds.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    applied: boolean("applied").notNull().default(true),
    track: text("track"),
    subjects: text("subjects"),
    paidAt: date("paid_at"),
    paidAmount: integer("paid_amount"),
    note: text("note"),
  },
  (t) => [uniqueIndex("mock_exam_applications_uq").on(t.roundId, t.memberId)],
);

// ---------- 설정 테이블 ----------
export const penaltyRules = pgTable("penalty_rules", {
  id: id(),
  /** null이면 본사 기본값 */
  branchId: uuid("branch_id").references(() => branches.id),
  name: text("name").notNull(),
  points: integer("points").notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (t) => [branchRls("penalty_rules", t.branchId, true)]).enableRLS();

export const boardItems = pgTable("board_items", {
  id: id(),
  branchId: uuid("branch_id").references(() => branches.id),
  key: text("key").notNull(),
  label: text("label").notNull(),
  kind: text("kind").$type<BoardItemKind>().notNull().default("daily"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (t) => [branchRls("board_items", t.branchId, true)]).enableRLS();

export const customFieldDefs = pgTable("custom_field_defs", {
  id: id(),
  branchId: uuid("branch_id").references(() => branches.id),
  entity: text("entity").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  type: text("type").notNull(),
  options: jsonb("options").$type<string[]>().notNull().default([]),
  required: boolean("required").notNull().default(false),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (t) => [branchRls("custom_field_defs", t.branchId, true)]).enableRLS();

// ---------- 집중관리일지 ----------
export const counselLogs = pgTable(
  "counsel_logs",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    logType: text("log_type").$type<CounselLogType>().notNull(),
    /** weekly: 주 시작(월요일), focus_daily: 일자 */
    periodDate: date("period_date").notNull(),
    issueText: text("issue_text"),
    issueBy: uuid("issue_by").references(() => users.id),
    issueAt: timestamp("issue_at", { withTimezone: true }),
    resolutionText: text("resolution_text"),
    resolutionBy: uuid("resolution_by").references(() => users.id),
    resolutionAt: timestamp("resolution_at", { withTimezone: true }),
    custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    branchRls("counsel_logs", t.branchId),
    uniqueIndex("counsel_logs_uq").on(t.memberId, t.logType, t.periodDate),
    index("counsel_logs_branch_period_idx").on(t.branchId, t.periodDate),
  ],
).enableRLS();

export const counselComments = pgTable("counsel_comments", {
  id: id(),
  logId: uuid("log_id")
    .notNull()
    .references(() => counselLogs.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id),
  body: text("body").notNull(),
  createdAt: createdAt(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
}, (t) => [index("counsel_comments_log_idx").on(t.logId)]);

// ---------- 라운딩 · 체크 ----------
export const roundingSessions = pgTable(
  "rounding_sessions",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    date: date("date").notNull(),
    roundNo: integer("round_no").notNull(),
    startedBy: uuid("started_by").references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [branchRls("rounding_sessions", t.branchId), uniqueIndex("rounding_sessions_uq").on(t.branchId, t.date, t.roundNo)],
).enableRLS();

export const checks = pgTable(
  "checks",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    seatNoSnapshot: integer("seat_no_snapshot"),
    date: date("date").notNull(),
    /** attendance | planner | vocab | checkout | round | (board_items.key) */
    itemKey: text("item_key").notNull(),
    /** 라운딩이면 1..n, 일별 항목이면 0 */
    roundNo: integer("round_no").notNull().default(0),
    sessionId: uuid("session_id").references(() => roundingSessions.id),
    grade: text("grade").$type<Grade>().notNull(),
    points: integer("points").notNull().default(0),
    penaltyRuleId: uuid("penalty_rule_id").references(() => penaltyRules.id),
    arrivalTime: time("arrival_time"),
    called: boolean("called"),
    note: text("note"),
    isIssue: boolean("is_issue").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    branchRls("checks", t.branchId),
    uniqueIndex("checks_uq").on(t.memberId, t.date, t.itemKey, t.roundNo),
    index("checks_branch_date_idx").on(t.branchId, t.date),
  ],
).enableRLS();

// ---------- 이슈 · 알림 · 감사 ----------
export const issues = pgTable(
  "issues",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    memberId: uuid("member_id").references(() => members.id),
    source: text("source").notNull().default("manual"),
    checkId: uuid("check_id").references(() => checks.id),
    title: text("title").notNull(),
    body: text("body"),
    severity: text("severity").notNull().default("normal"),
    status: text("status").$type<IssueStatus>().notNull().default("open"),
    reportedBy: uuid("reported_by").references(() => users.id),
    assignedTo: uuid("assigned_to").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [branchRls("issues", t.branchId), index("issues_branch_status_idx").on(t.branchId, t.status)],
).enableRLS();

export const issueComments = pgTable("issue_comments", {
  id: id(),
  issueId: uuid("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (t) => [index("issue_comments_issue_idx").on(t.issueId)]);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [branchRls("notifications", t.branchId, true), index("notifications_user_read_idx").on(t.userId, t.readAt)],
).enableRLS();

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorId: uuid("actor_id").references(() => users.id),
    branchId: uuid("branch_id").references(() => branches.id),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [branchRls("audit_logs", t.branchId, true), index("audit_logs_entity_idx").on(t.entity, t.entityId)],
).enableRLS();

export const accessLogs = pgTable("access_logs", {
  id: id(),
  actorId: uuid("actor_id").references(() => users.id),
  branchId: uuid("branch_id").references(() => branches.id),
  entity: text("entity").notNull(),
  entityId: uuid("entity_id").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [branchRls("access_logs", t.branchId, true)]).enableRLS();

// ---------- 2단계: 식사주문 · 정산 ----------
export type MealKind = "lunch" | "dinner";
export type MealSettingsRow = typeof mealSettings.$inferSelect;

export const mealSettings = pgTable("meal_settings", {
  id: id(),
  branchId: uuid("branch_id")
    .notNull()
    .unique()
    .references(() => branches.id, { onDelete: "cascade" }),
  lunchPrice: integer("lunch_price").notNull().default(8000),
  dinnerPrice: integer("dinner_price").notNull().default(8000),
  /** 전일 마감 시각 "HH:mm" */
  cutoffTime: text("cutoff_time").notNull().default("23:59"),
  saturdayLunchOnly: boolean("saturday_lunch_only").notNull().default(true),
  sundayClosed: boolean("sunday_closed").notNull().default(true),
  closedDates: jsonb("closed_dates").$type<string[]>().notNull().default([]),
  vendorName: text("vendor_name"),
  vendorPhone: text("vendor_phone"),
  updatedAt: updatedAt(),
}, (t) => [branchRls("meal_settings", t.branchId, true)]).enableRLS();

export const mealOrders = pgTable(
  "meal_orders",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    date: date("date").notNull(),
    meal: text("meal").$type<MealKind>().notNull(),
    ordered: boolean("ordered").notNull().default(true),
    priceSnapshot: integer("price_snapshot").notNull(),
    changedBy: uuid("changed_by").references(() => users.id),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [branchRls("meal_orders", t.branchId), uniqueIndex("meal_orders_uq").on(t.memberId, t.date, t.meal), index("meal_orders_branch_date_idx").on(t.branchId, t.date)],
).enableRLS();

export const mealSettlements = pgTable(
  "meal_settlements",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    yearMonth: text("year_month").notNull(),
    mealCount: integer("meal_count").notNull().default(0),
    amount: integer("amount").notNull().default(0),
    paidAt: date("paid_at"),
    paidAmount: integer("paid_amount"),
    note: text("note"),
    updatedAt: updatedAt(),
  },
  (t) => [branchRls("meal_settlements", t.branchId), uniqueIndex("meal_settlements_uq").on(t.memberId, t.yearMonth)],
).enableRLS();

// ---------- 2단계: 근무일지 · 급여 ----------
export const staffProfiles = pgTable("staff_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id),
  employmentType: text("employment_type").notNull().default("주간조교"),
  hourlyRate: integer("hourly_rate"),
  workDays: text("work_days"),
  /** 하루 근무 예정 시간 × 100. 출퇴근 게이지가 채워지는 목표치이고, 비워 두면 8시간으로 본다 */
  targetHoursX100: integer("target_hours_x100"),
  direct: boolean("direct").notNull().default(true),
  updatedAt: updatedAt(),
}, (t) => [branchRls("staff_profiles", t.branchId, true)]).enableRLS();

export const shiftSlots = pgTable(
  "shift_slots",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    /** 이 타임을 체크했을 때 인정 시간 (예: 0.5, 1.5) */
    hours: integer("hours_x100").notNull(),
    weekend: boolean("weekend").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [branchRls("shift_slots", t.branchId), uniqueIndex("shift_slots_uq").on(t.branchId, t.key)],
).enableRLS();

export const workLogs = pgTable(
  "work_logs",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    date: date("date").notNull(),
    slotKeys: jsonb("slot_keys").$type<string[]>().notNull().default([]),
    /** 실제로 출근 버튼을 누른 시각. 누르지 않고 타임 체크만 해도 되므로 비어 있을 수 있다 */
    clockInAt: timestamp("clock_in_at", { withTimezone: true }),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
    /**
     * 인정 시간 × 100 (소수 오차 방지).
     * 출근·퇴근을 모두 누른 날은 그 사이 시간이 곧 인정 시간이고 타임 체크로 덮어쓰지 않는다.
     * 누르지 않은 날은 지금처럼 체크한 타임의 인정 시간을 더한다.
     */
    hoursX100: integer("hours_x100").notNull().default(0),
    overtimeX100: integer("overtime_x100").notNull().default(0),
    overtimeReason: text("overtime_reason"),
    note: text("note"),
    hqConfirmedBy: uuid("hq_confirmed_by").references(() => users.id),
    hqConfirmedAt: timestamp("hq_confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [branchRls("work_logs", t.branchId), uniqueIndex("work_logs_uq").on(t.branchId, t.userId, t.date), index("work_logs_branch_date_idx").on(t.branchId, t.date)],
).enableRLS();

// ---------- 2단계: 알림톡 ----------
export const alimtalkTemplates = pgTable("alimtalk_templates", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  variables: jsonb("variables").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type MessageStatus = "queued" | "sent" | "failed";

export const alimtalkMessages = pgTable(
  "alimtalk_messages",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    templateId: uuid("template_id").references(() => alimtalkTemplates.id),
    memberId: uuid("member_id").references(() => members.id),
    recipientType: text("recipient_type").notNull().default("member"),
    recipientPhone: text("recipient_phone").notNull(),
    recipientName: text("recipient_name"),
    variables: jsonb("variables").$type<Record<string, string>>().notNull().default({}),
    renderedText: text("rendered_text").notNull(),
    status: text("status").$type<MessageStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    batchId: uuid("batch_id"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [branchRls("alimtalk_messages", t.branchId), index("alimtalk_messages_branch_idx").on(t.branchId, t.createdAt), index("alimtalk_messages_status_idx").on(t.status)],
).enableRLS();

// ---------- 3단계: 파일 · HERO · 외부 알림 ----------
export type MemberFileKind = "hero_result" | "ai_report" | "other";

export const memberFiles = pgTable(
  "member_files",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    kind: text("kind").$type<MemberFileKind>().notNull().default("other"),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    version: integer("version").notNull().default(1),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [branchRls("member_files", t.branchId), index("member_files_member_idx").on(t.memberId, t.kind)],
).enableRLS();

export const heroLinks = pgTable(
  "hero_links",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    resultUrl: text("result_url"),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [branchRls("hero_links", t.branchId), uniqueIndex("hero_links_external_uq").on(t.externalId)],
).enableRLS();

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: id(),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  events: jsonb("events").$type<string[]>().notNull().default(["issue.created", "penalty.high"]),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [branchRls("webhook_endpoints", t.branchId)]).enableRLS();

export type OutboxStatus = "pending" | "sent" | "failed";

export const eventOutbox = pgTable(
  "event_outbox",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    text: text("text").notNull(),
    status: text("status").$type<OutboxStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [branchRls("event_outbox", t.branchId), index("event_outbox_status_idx").on(t.status, t.createdAt)],
).enableRLS();

// ---------- 상담일정 (예약) ----------
/** 신규 상담인지 재상담인지. 신규는 아직 회원이 아니라 이름만으로 잡는다 */
export type AppointmentKind = "new" | "member" | "guardian";
export type AppointmentStatus = "scheduled" | "done" | "canceled" | "noshow";

export const counselAppointments = pgTable(
  "counsel_appointments",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** 'HH:MM'. 화면의 시간대(08~12 등)는 이 값으로 나눈다 */
    startTime: text("start_time").notNull(),
    endTime: text("end_time"),
    kind: text("kind").$type<AppointmentKind>().notNull().default("new"),
    /** 재상담이면 회원, 신규면 비어 있고 personName 을 쓴다 */
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    personName: text("person_name"),
    personPhone: text("person_phone"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    note: text("note"),
    status: text("status").$type<AppointmentStatus>().notNull().default("scheduled"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [branchRls("counsel_appointments", t.branchId), index("counsel_appointments_date_idx").on(t.branchId, t.date)],
).enableRLS();

// ---------- 인수인계 노트 ----------
/** 공지는 목록 위에 고정된다 */
export type HandoverKind = "handover" | "notice";

export const handoverNotes = pgTable(
  "handover_notes",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** 근무 타임 키(shift_slots.key). 어느 타임에 있었던 일인지 */
    slotKey: text("slot_key"),
    kind: text("kind").$type<HandoverKind>().notNull().default("handover"),
    body: text("body").notNull(),
    authorId: uuid("author_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [branchRls("handover_notes", t.branchId), index("handover_notes_date_idx").on(t.branchId, t.date)],
).enableRLS();

/** 누가 어디까지 읽었는지. 자기 근무시간이 아닐 때 지나간 글을 찾아 읽게 하는 핵심 */
export const handoverReads = pgTable(
  "handover_reads",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => handoverNotes.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.userId] })],
);

export const handoverComments = pgTable("handover_comments", {
  id: id(),
  noteId: uuid("note_id")
    .notNull()
    .references(() => handoverNotes.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => users.id),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (t) => [index("handover_comments_note_idx").on(t.noteId)]);

// ---------- 좌석 이용료 · 결제 ----------
/** 좌석 등급별 요금표. 학생·성인 요금이 다르다 (원목 490,000 / 성인 670,000 등) */
export const feePlans = pgTable(
  "fee_plans",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    studentPrice: integer("student_price").notNull().default(0),
    adultPrice: integer("adult_price").notNull().default(0),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [branchRls("fee_plans", t.branchId), uniqueIndex("fee_plans_branch_name_uq").on(t.branchId, t.name)],
).enableRLS();

export type SeatPaymentStatus = "pending" | "paid" | "closed";

/** 등록기간 한 건 = 결제 한 건. 금액은 요금표에서 계산해 채우되 손으로 고칠 수 있다 */
export const seatPayments = pgTable(
  "seat_payments",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    enrollmentId: uuid("enrollment_id").references(() => memberEnrollments.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    /** 계산 시점의 요금표 이름·기본 금액을 남긴다 (요금표를 바꿔도 지난 건은 그대로) */
    planName: text("plan_name"),
    baseAmount: integer("base_amount").notNull().default(0),
    discount: integer("discount").notNull().default(0),
    amount: integer("amount").notNull().default(0),
    paidAt: date("paid_at"),
    paidAmount: integer("paid_amount"),
    status: text("status").$type<SeatPaymentStatus>().notNull().default("pending"),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    branchRls("seat_payments", t.branchId),
    uniqueIndex("seat_payments_enrollment_uq").on(t.enrollmentId),
    index("seat_payments_branch_period_idx").on(t.branchId, t.periodStart),
  ],
).enableRLS();
