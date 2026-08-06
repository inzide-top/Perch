CREATE TABLE "answer_deep_evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"turn_id" uuid NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"model_name" text NOT NULL,
	"prompt_version" text NOT NULL,
	"agent_run_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "interview_question_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"turn_id" uuid NOT NULL,
	"rating" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"comment" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_session_evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"evaluated_through_turn_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "interview_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"job_analysis_id" uuid NOT NULL,
	"job_analysis_run_id" uuid,
	"resume_version_id" uuid NOT NULL,
	"configuration" jsonb NOT NULL,
	"assessment_plan" jsonb,
	"model_snapshot" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"current_turn_id" uuid,
	"status" text NOT NULL,
	"evidence_status" text NOT NULL,
	"end_reason" text,
	"latest_overall_score" integer,
	"overall_score_status" text NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"last_active_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_turn_interactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"turn_id" uuid NOT NULL,
	"reply_to_interaction_id" uuid,
	"client_message_id" uuid,
	"sequence_number" integer NOT NULL,
	"role" text NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"assessment_plan_id" uuid NOT NULL,
	"root_turn_id" uuid,
	"parent_turn_id" uuid,
	"kind" text NOT NULL,
	"sequence_number" integer NOT NULL,
	"main_question_number" integer NOT NULL,
	"follow_up_number" integer DEFAULT 0 NOT NULL,
	"question" jsonb NOT NULL,
	"hints" jsonb NOT NULL,
	"answer" jsonb,
	"hint_usage" text DEFAULT 'none' NOT NULL,
	"skip" jsonb,
	"answer_evidence" jsonb,
	"answer_submission_key" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX "agent_runs_analysis_id_attempt_number_unique";--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "analysis_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "workflow_type" text DEFAULT 'job_analysis' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "interview_session_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "interview_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "operation_key" text;--> statement-breakpoint
UPDATE "agent_runs"
SET "operation_key" = 'job_analysis:' || "analysis_id"::text
WHERE "operation_key" IS NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "operation_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "answer_deep_evaluations" ADD CONSTRAINT "answer_deep_evaluations_turn_id_interview_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_deep_evaluations" ADD CONSTRAINT "answer_deep_evaluations_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_question_feedback" ADD CONSTRAINT "interview_question_feedback_turn_id_interview_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_session_evaluations" ADD CONSTRAINT "interview_session_evaluations_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_session_evaluations" ADD CONSTRAINT "interview_session_evaluations_evaluated_through_turn_id_interview_turns_id_fk" FOREIGN KEY ("evaluated_through_turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_opportunity_id_job_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."job_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_job_analysis_id_job_analyses_id_fk" FOREIGN KEY ("job_analysis_id") REFERENCES "public"."job_analyses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_job_analysis_run_id_agent_runs_id_fk" FOREIGN KEY ("job_analysis_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_resume_version_id_resume_versions_id_fk" FOREIGN KEY ("resume_version_id") REFERENCES "public"."resume_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_current_turn_id_interview_turns_id_fk" FOREIGN KEY ("current_turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turn_interactions" ADD CONSTRAINT "interview_turn_interactions_turn_id_interview_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turn_interactions" ADD CONSTRAINT "interview_turn_interactions_reply_to_interaction_id_interview_turn_interactions_id_fk" FOREIGN KEY ("reply_to_interaction_id") REFERENCES "public"."interview_turn_interactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turns" ADD CONSTRAINT "interview_turns_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turns" ADD CONSTRAINT "interview_turns_root_turn_id_interview_turns_id_fk" FOREIGN KEY ("root_turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turns" ADD CONSTRAINT "interview_turns_parent_turn_id_interview_turns_id_fk" FOREIGN KEY ("parent_turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_deep_evaluations_turn_id_unique" ON "answer_deep_evaluations" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_question_feedback_turn_id_unique" ON "interview_question_feedback" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_session_evaluations_session_id_unique" ON "interview_session_evaluations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "interview_sessions_opportunity_id_index" ON "interview_sessions" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "interview_sessions_status_index" ON "interview_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "interview_sessions_updated_at_index" ON "interview_sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turn_interactions_turn_sequence_unique" ON "interview_turn_interactions" USING btree ("turn_id","sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turn_interactions_client_message_id_unique" ON "interview_turn_interactions" USING btree ("client_message_id");--> statement-breakpoint
CREATE INDEX "interview_turn_interactions_turn_id_index" ON "interview_turn_interactions" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turns_session_id_sequence_unique" ON "interview_turns" USING btree ("session_id","sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turns_answer_submission_key_unique" ON "interview_turns" USING btree ("answer_submission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turns_one_open_turn_per_session_unique" ON "interview_turns" USING btree ("session_id") WHERE "status" IN ('awaiting_answer', 'processing', 'processing_failed');--> statement-breakpoint
CREATE INDEX "interview_turns_session_id_index" ON "interview_turns" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "interview_turns_root_turn_id_index" ON "interview_turns" USING btree ("root_turn_id");--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_interview_session_id_interview_sessions_id_fk" FOREIGN KEY ("interview_session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_interview_turn_id_interview_turns_id_fk" FOREIGN KEY ("interview_turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_operation_key_attempt_number_unique" ON "agent_runs" USING btree ("operation_key","attempt_number");--> statement-breakpoint
CREATE INDEX "agent_runs_interview_session_id_index" ON "agent_runs" USING btree ("interview_session_id");--> statement-breakpoint
CREATE INDEX "agent_runs_interview_turn_id_index" ON "agent_runs" USING btree ("interview_turn_id");
