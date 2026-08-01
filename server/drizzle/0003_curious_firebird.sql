CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text NOT NULL,
	"model_name" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input" jsonb NOT NULL,
	"raw_output" text,
	"parsed_output" jsonb,
	"error" jsonb,
	"duration_ms" integer,
	"token_usage" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_analysis_id_job_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."job_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_analysis_id_attempt_number_unique" ON "agent_runs" USING btree ("analysis_id","attempt_number");--> statement-breakpoint
CREATE INDEX "agent_runs_analysis_id_index" ON "agent_runs" USING btree ("analysis_id");