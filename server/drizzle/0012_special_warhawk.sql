CREATE TABLE "review_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"interview_round_id" uuid,
	"raw_text" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"current_attempt" integer DEFAULT 0 NOT NULL,
	"model_name" text,
	"prompt_version" text,
	"error" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "review_document_id" uuid;--> statement-breakpoint
ALTER TABLE "review_documents" ADD CONSTRAINT "review_documents_opportunity_id_job_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."job_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_documents" ADD CONSTRAINT "review_documents_interview_round_id_interview_rounds_id_fk" FOREIGN KEY ("interview_round_id") REFERENCES "public"."interview_rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_documents_written_test_opportunity_unique" ON "review_documents" USING btree ("opportunity_id") WHERE "source_type" = 'written_test';--> statement-breakpoint
CREATE UNIQUE INDEX "review_documents_interview_round_unique" ON "review_documents" USING btree ("interview_round_id") WHERE "source_type" = 'interview';--> statement-breakpoint
CREATE INDEX "review_documents_opportunity_id_index" ON "review_documents" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "review_documents_status_index" ON "review_documents" USING btree ("status");--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_review_document_id_review_documents_id_fk" FOREIGN KEY ("review_document_id") REFERENCES "public"."review_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_review_document_id_index" ON "agent_runs" USING btree ("review_document_id");