CREATE TABLE "action_strategy_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"model_name" text,
	"model_base_url" text,
	"prompt_version" text NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"current_attempt" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "action_strategy_snapshot_id" uuid;--> statement-breakpoint
CREATE INDEX "action_strategy_snapshots_user_id_updated_at_index" ON "action_strategy_snapshots" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "action_strategy_snapshots_fingerprint_index" ON "action_strategy_snapshots" USING btree ("user_id","input_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "action_strategy_snapshots_active_user_unique" ON "action_strategy_snapshots" USING btree ("user_id") WHERE "status" IN ('pending', 'processing');--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_action_strategy_snapshot_id_action_strategy_snapshots_id_fk" FOREIGN KEY ("action_strategy_snapshot_id") REFERENCES "public"."action_strategy_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_action_strategy_snapshot_id_index" ON "agent_runs" USING btree ("action_strategy_snapshot_id");