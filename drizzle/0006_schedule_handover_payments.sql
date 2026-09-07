CREATE TABLE "counsel_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text,
	"kind" text DEFAULT 'new' NOT NULL,
	"member_id" uuid,
	"person_name" text,
	"person_phone" text,
	"assigned_to" uuid,
	"note" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "counsel_appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"student_price" integer DEFAULT 0 NOT NULL,
	"adult_price" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "handover_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handover_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot_key" text,
	"kind" text DEFAULT 'handover' NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handover_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "handover_reads" (
	"note_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handover_reads_note_id_user_id_pk" PRIMARY KEY("note_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "seat_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"enrollment_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"plan_name" text,
	"base_amount" integer DEFAULT 0 NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"paid_at" date,
	"paid_amount" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seat_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seats" ADD COLUMN "fee_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "counsel_appointments" ADD CONSTRAINT "counsel_appointments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counsel_appointments" ADD CONSTRAINT "counsel_appointments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counsel_appointments" ADD CONSTRAINT "counsel_appointments_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counsel_appointments" ADD CONSTRAINT "counsel_appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_comments" ADD CONSTRAINT "handover_comments_note_id_handover_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."handover_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_comments" ADD CONSTRAINT "handover_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_notes" ADD CONSTRAINT "handover_notes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_notes" ADD CONSTRAINT "handover_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_reads" ADD CONSTRAINT "handover_reads_note_id_handover_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."handover_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_reads" ADD CONSTRAINT "handover_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_payments" ADD CONSTRAINT "seat_payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_payments" ADD CONSTRAINT "seat_payments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_payments" ADD CONSTRAINT "seat_payments_enrollment_id_member_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."member_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "counsel_appointments_date_idx" ON "counsel_appointments" USING btree ("branch_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_plans_branch_name_uq" ON "fee_plans" USING btree ("branch_id","name");--> statement-breakpoint
CREATE INDEX "handover_notes_date_idx" ON "handover_notes" USING btree ("branch_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "seat_payments_enrollment_uq" ON "seat_payments" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "seat_payments_branch_period_idx" ON "seat_payments" USING btree ("branch_id","period_start");--> statement-breakpoint
CREATE POLICY "counsel_appointments_branch_rls" ON "counsel_appointments" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "counsel_appointments"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_plans_branch_rls" ON "fee_plans" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "fee_plans"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "handover_notes_branch_rls" ON "handover_notes" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "handover_notes"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "seat_payments_branch_rls" ON "seat_payments" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "seat_payments"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);