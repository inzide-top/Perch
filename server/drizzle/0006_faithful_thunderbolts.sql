DROP TABLE "company_profiles" CASCADE;--> statement-breakpoint
ALTER TABLE "job_analyses" ADD COLUMN "current_attempt" integer DEFAULT 1 NOT NULL;