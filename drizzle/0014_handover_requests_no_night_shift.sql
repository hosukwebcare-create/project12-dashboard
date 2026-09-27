ALTER TABLE "handover_notes" ADD COLUMN "done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handover_notes" ADD COLUMN "done_by" uuid;--> statement-breakpoint
ALTER TABLE "handover_notes" ADD CONSTRAINT "handover_notes_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- 야간조교는 없어졌다(2026-09 현장 확인). 타임은 지우지 않고 쉬게 둔다 — 지난 근무 기록이 그 키를 가리키고 있다.
UPDATE "shift_slots" SET "active" = false WHERE "audience" = '야간조교';
