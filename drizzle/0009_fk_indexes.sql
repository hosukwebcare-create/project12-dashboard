CREATE INDEX "counsel_comments_log_idx" ON "counsel_comments" USING btree ("log_id");--> statement-breakpoint
CREATE INDEX "handover_comments_note_idx" ON "handover_comments" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "issue_comments_issue_idx" ON "issue_comments" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "member_enrollments_member_idx" ON "member_enrollments" USING btree ("member_id","start_date");--> statement-breakpoint
CREATE INDEX "member_guardians_member_idx" ON "member_guardians" USING btree ("member_id");