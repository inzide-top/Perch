CREATE TABLE "interview_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" text NOT NULL,
	"result" text NOT NULL,
	"note" text NOT NULL,
	"review_note" text NOT NULL,
	"key_takeaways" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_opportunities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company" text NOT NULL,
	"job_title" text NOT NULL,
	"address" jsonb NOT NULL,
	"introduction" text NOT NULL,
	"description" text NOT NULL,
	"status" text NOT NULL,
	"include_written_test" boolean NOT NULL,
	"intention_level" text NOT NULL,
	"industry" text NOT NULL,
	"note" text NOT NULL,
	"written_test_scheduled_at" timestamp with time zone,
	"written_test_review_note" text,
	"written_test_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"trigger" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_terminations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"related_interview_round_id" uuid,
	"related_interview_round_title" text,
	"reason_code" text NOT NULL,
	"reason_note" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_rounds" ADD CONSTRAINT "interview_rounds_opportunity_id_job_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."job_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_status_history" ADD CONSTRAINT "opportunity_status_history_opportunity_id_job_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."job_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_terminations" ADD CONSTRAINT "opportunity_terminations_opportunity_id_job_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."job_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_terminations" ADD CONSTRAINT "opportunity_terminations_related_interview_round_id_interview_rounds_id_fk" FOREIGN KEY ("related_interview_round_id") REFERENCES "public"."interview_rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_rounds_opportunity_id_sequence_unique" ON "interview_rounds" USING btree ("opportunity_id","sequence");--> statement-breakpoint
CREATE INDEX "interview_rounds_opportunity_id_index" ON "interview_rounds" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "job_opportunities_user_id_updated_at_index" ON "job_opportunities" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "opportunity_status_history_opportunity_id_index" ON "opportunity_status_history" USING btree ("opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_terminations_opportunity_id_unique" ON "opportunity_terminations" USING btree ("opportunity_id");