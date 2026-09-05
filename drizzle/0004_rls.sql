ALTER TABLE "access_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alimtalk_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "board_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "counsel_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_defs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hero_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "issues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meal_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meal_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meal_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mock_exam_rounds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "penalty_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rounding_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "access_logs_branch_rls" ON "access_logs" AS PERMISSIVE FOR ALL TO public USING ("access_logs"."branch_id" is null or (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "access_logs"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "alimtalk_messages_branch_rls" ON "alimtalk_messages" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "alimtalk_messages"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "audit_logs_branch_rls" ON "audit_logs" AS PERMISSIVE FOR ALL TO public USING ("audit_logs"."branch_id" is null or (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "audit_logs"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "board_items_branch_rls" ON "board_items" AS PERMISSIVE FOR ALL TO public USING ("board_items"."branch_id" is null or (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "board_items"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "checks_branch_rls" ON "checks" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "checks"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "counsel_logs_branch_rls" ON "counsel_logs" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "counsel_logs"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "custom_field_defs_branch_rls" ON "custom_field_defs" AS PERMISSIVE FOR ALL TO public USING ("custom_field_defs"."branch_id" is null or (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "custom_field_defs"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "event_outbox_branch_rls" ON "event_outbox" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "event_outbox"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "hero_links_branch_rls" ON "hero_links" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "hero_links"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "issues_branch_rls" ON "issues" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "issues"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "meal_orders_branch_rls" ON "meal_orders" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "meal_orders"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "meal_settings_branch_rls" ON "meal_settings" AS PERMISSIVE FOR ALL TO public USING ("meal_settings"."branch_id" is null or (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "meal_settings"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "meal_settlements_branch_rls" ON "meal_settlements" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "meal_settlements"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "member_files_branch_rls" ON "member_files" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "member_files"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "members_branch_rls" ON "members" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "members"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "mock_exam_rounds_branch_rls" ON "mock_exam_rounds" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "mock_exam_rounds"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notifications_branch_rls" ON "notifications" AS PERMISSIVE FOR ALL TO public USING ("notifications"."branch_id" is null or (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "notifications"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "penalty_rules_branch_rls" ON "penalty_rules" AS PERMISSIVE FOR ALL TO public USING ("penalty_rules"."branch_id" is null or (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "penalty_rules"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "rounding_sessions_branch_rls" ON "rounding_sessions" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "rounding_sessions"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "seats_branch_rls" ON "seats" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "seats"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shift_slots_branch_rls" ON "shift_slots" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "shift_slots"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "staff_profiles_branch_rls" ON "staff_profiles" AS PERMISSIVE FOR ALL TO public USING ("staff_profiles"."branch_id" is null or (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "staff_profiles"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "webhook_endpoints_branch_rls" ON "webhook_endpoints" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "webhook_endpoints"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "work_logs_branch_rls" ON "work_logs" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.rls', true) is distinct from 'on' or current_setting('app.is_hq', true) = 'true' or "work_logs"."branch_id" = nullif(current_setting('app.branch_id', true), '')::uuid);
ALTER TABLE "access_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alimtalk_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "board_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "counsel_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_defs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hero_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "issues" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meal_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meal_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meal_settlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mock_exam_rounds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "penalty_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rounding_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_slots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_logs" FORCE ROW LEVEL SECURITY;
