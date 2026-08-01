CREATE TABLE "job_analyses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"resume_id" uuid NOT NULL,
	"resume_version_id" uuid NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "job_analyses" ADD CONSTRAINT "job_analyses_opportunity_id_job_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."job_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_analyses" ADD CONSTRAINT "job_analyses_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_analyses" ADD CONSTRAINT "job_analyses_resume_version_id_resume_versions_id_fk" FOREIGN KEY ("resume_version_id") REFERENCES "public"."resume_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_analyses_opportunity_id_unique" ON "job_analyses" USING btree ("opportunity_id");
--> statement-breakpoint
-- `analyzing` 不再属于求职流程状态。保留创建事件，将其规范为待投递，
-- 并移除原先紧随其后的 analyzing -> pending_apply 过渡记录。
DELETE FROM "opportunity_status_history"
WHERE "from_status" = 'analyzing' AND "to_status" = 'pending_apply';
--> statement-breakpoint
UPDATE "opportunity_status_history"
SET
  "to_status" = 'pending_apply',
  "note" = CASE
    WHEN "note" = '创建机会后进入分析中' THEN '创建机会'
    ELSE "note"
  END
WHERE "from_status" IS NULL AND "to_status" = 'analyzing';
--> statement-breakpoint
UPDATE "job_opportunities"
SET "status" = 'pending_apply'
WHERE "status" = 'analyzing';
