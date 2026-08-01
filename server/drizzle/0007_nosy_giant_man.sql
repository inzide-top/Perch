ALTER TABLE "job_analyses" ADD COLUMN "input_fingerprint" text;--> statement-breakpoint
CREATE INDEX "job_analyses_input_fingerprint_index" ON "job_analyses" USING btree ("input_fingerprint");