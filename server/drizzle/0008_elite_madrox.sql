ALTER TABLE "job_analyses" ADD COLUMN "source_analysis_id" uuid;--> statement-breakpoint
ALTER TABLE "job_analyses" ADD CONSTRAINT "job_analyses_source_analysis_id_job_analyses_id_fk" FOREIGN KEY ("source_analysis_id") REFERENCES "public"."job_analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_analyses_source_analysis_id_index" ON "job_analyses" USING btree ("source_analysis_id");
