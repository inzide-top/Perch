ALTER TABLE "chat_runs" DROP CONSTRAINT "chat_runs_input_message_id_chat_messages_id_fk";
--> statement-breakpoint
DROP INDEX "chat_runs_active_input_message_unique";--> statement-breakpoint
ALTER TABLE "chat_commands" ALTER COLUMN "expected_revision" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_runs" ALTER COLUMN "input_message_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_runs" ALTER COLUMN "phase" DROP NOT NULL;--> statement-breakpoint
UPDATE "chat_runs"
SET
	"status" = CASE
		WHEN "status" = 'pending' THEN 'queued'
		WHEN "status" = 'processing' AND "phase" = 'waiting_confirmation' THEN 'waiting_confirmation'
		WHEN "status" = 'processing' THEN 'running'
		ELSE "status"
	END,
	"phase" = CASE
		WHEN "status" = 'processing' AND "phase" <> 'waiting_confirmation' THEN
			CASE
				WHEN "phase" IN ('queued', 'planning') THEN 'initializing'
				WHEN "phase" = 'streaming' THEN 'streaming_response'
				ELSE "phase"
			END
		ELSE NULL
	END;--> statement-breakpoint
ALTER TABLE "chat_runs" ADD CONSTRAINT "chat_runs_input_message_id_chat_messages_id_fk" FOREIGN KEY ("input_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_runs_active_conversation_unique" ON "chat_runs" USING btree ("conversation_id") WHERE "status" IN ('queued', 'running', 'waiting_input', 'waiting_confirmation', 'cancelling');--> statement-breakpoint
CREATE UNIQUE INDEX "chat_runs_active_input_message_unique" ON "chat_runs" USING btree ("input_message_id") WHERE "status" IN ('queued', 'running', 'waiting_input', 'waiting_confirmation', 'cancelling');--> statement-breakpoint
ALTER TABLE "chat_runs" ADD CONSTRAINT "chat_runs_status_phase_check" CHECK (("status" = 'running' AND "phase" IS NOT NULL) OR ("status" <> 'running' AND "phase" IS NULL));
