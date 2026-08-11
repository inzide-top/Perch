CREATE TABLE "chat_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"message_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"status" text NOT NULL,
	"content" text,
	"error" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"command_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"run_id" uuid,
	"type" text NOT NULL,
	"expected_revision" integer NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"rejection_code" text,
	"created_at" timestamp with time zone NOT NULL,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"scope_type" text NOT NULL,
	"opportunity_id" uuid,
	"archived_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_conversations_scope_relation_check" CHECK (("scope_type" = 'global' AND "opportunity_id" IS NULL) OR ("scope_type" = 'opportunity' AND "opportunity_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"chat_run_id" uuid,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"sequence_number" integer NOT NULL,
	"replaces_message_id" uuid,
	"parts" jsonb NOT NULL,
	"references" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_run_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"state_revision" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"input_message_id" uuid,
	"output_message_id" uuid,
	"status" text NOT NULL,
	"phase" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"model_snapshot" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"budget" jsonb NOT NULL,
	"token_usage" jsonb,
	"input" jsonb NOT NULL,
	"runtime_state" jsonb,
	"error" jsonb,
	"retry_of_run_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_tool_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"tool_version" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" text NOT NULL,
	"missing_arguments" jsonb,
	"requires_confirmation" boolean DEFAULT false NOT NULL,
	"user_decision" text,
	"output" jsonb,
	"error" jsonb,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "chat_run_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_artifacts" ADD CONSTRAINT "chat_artifacts_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_artifacts" ADD CONSTRAINT "chat_artifacts_run_id_chat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."chat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_artifacts" ADD CONSTRAINT "chat_artifacts_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_commands" ADD CONSTRAINT "chat_commands_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_commands" ADD CONSTRAINT "chat_commands_run_id_chat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."chat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_opportunity_id_job_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."job_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_run_id_chat_runs_id_fk" FOREIGN KEY ("chat_run_id") REFERENCES "public"."chat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_replaces_message_id_chat_messages_id_fk" FOREIGN KEY ("replaces_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_run_events" ADD CONSTRAINT "chat_run_events_run_id_chat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."chat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_runs" ADD CONSTRAINT "chat_runs_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_runs" ADD CONSTRAINT "chat_runs_input_message_id_chat_messages_id_fk" FOREIGN KEY ("input_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_runs" ADD CONSTRAINT "chat_runs_output_message_id_chat_messages_id_fk" FOREIGN KEY ("output_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_runs" ADD CONSTRAINT "chat_runs_retry_of_run_id_chat_runs_id_fk" FOREIGN KEY ("retry_of_run_id") REFERENCES "public"."chat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tool_actions" ADD CONSTRAINT "chat_tool_actions_run_id_chat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."chat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_artifacts_conversation_id_index" ON "chat_artifacts" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "chat_artifacts_run_id_index" ON "chat_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "chat_artifacts_message_id_index" ON "chat_artifacts" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_commands_command_id_unique" ON "chat_commands" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "chat_commands_conversation_id_created_at_index" ON "chat_commands" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_commands_run_id_index" ON "chat_commands" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "chat_conversations_user_id_updated_at_index" ON "chat_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "chat_conversations_opportunity_id_index" ON "chat_conversations" USING btree ("opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_conversation_id_sequence_unique" ON "chat_messages" USING btree ("conversation_id","sequence_number");--> statement-breakpoint
CREATE INDEX "chat_messages_chat_run_id_index" ON "chat_messages" USING btree ("chat_run_id");--> statement-breakpoint
CREATE INDEX "chat_messages_replaces_message_id_index" ON "chat_messages" USING btree ("replaces_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_run_events_run_id_sequence_unique" ON "chat_run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "chat_run_events_run_id_index" ON "chat_run_events" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_runs_active_input_message_unique" ON "chat_runs" USING btree ("input_message_id") WHERE "status" IN ('pending', 'processing', 'waiting_confirmation');--> statement-breakpoint
CREATE INDEX "chat_runs_conversation_id_updated_at_index" ON "chat_runs" USING btree ("conversation_id","updated_at");--> statement-breakpoint
CREATE INDEX "chat_runs_status_index" ON "chat_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chat_runs_input_message_id_index" ON "chat_runs" USING btree ("input_message_id");--> statement-breakpoint
CREATE INDEX "chat_runs_retry_of_run_id_index" ON "chat_runs" USING btree ("retry_of_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_tool_actions_run_id_idempotency_unique" ON "chat_tool_actions" USING btree ("run_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "chat_tool_actions_run_id_status_index" ON "chat_tool_actions" USING btree ("run_id","status");--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_chat_run_id_chat_runs_id_fk" FOREIGN KEY ("chat_run_id") REFERENCES "public"."chat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_chat_run_id_index" ON "agent_runs" USING btree ("chat_run_id");