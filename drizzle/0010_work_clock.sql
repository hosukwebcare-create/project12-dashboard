ALTER TABLE "staff_profiles" ADD COLUMN "target_hours_x100" integer;--> statement-breakpoint
ALTER TABLE "work_logs" ADD COLUMN "clock_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_logs" ADD COLUMN "clock_out_at" timestamp with time zone;