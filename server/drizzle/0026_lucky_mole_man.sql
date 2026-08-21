DROP INDEX "job_opportunities_user_dedupe_fingerprint_unique";--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_opportunities" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "interview_sessions_archived_at_index" ON "interview_sessions" USING btree ("archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_opportunities_user_dedupe_fingerprint_unique" ON "job_opportunities" USING btree ("user_id","dedupe_fingerprint") WHERE "job_opportunities"."deleted_at" IS NULL;