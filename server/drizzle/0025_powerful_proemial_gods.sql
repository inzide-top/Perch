ALTER TABLE "agent_runs" ADD COLUMN "resume_pdf_import_task_id" uuid;--> statement-breakpoint
ALTER TABLE "resume_pdf_import_tasks" ADD COLUMN "current_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_resume_pdf_import_task_id_resume_pdf_import_tasks_id_fk" FOREIGN KEY ("resume_pdf_import_task_id") REFERENCES "public"."resume_pdf_import_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_resume_pdf_import_task_id_index" ON "agent_runs" USING btree ("resume_pdf_import_task_id");