ALTER TABLE "members" ADD COLUMN "withdrawn_at" date;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_logins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;