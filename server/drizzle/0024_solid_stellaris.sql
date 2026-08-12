CREATE TABLE "chat_conversation_summaries" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"summary" jsonb NOT NULL,
	"summarized_through_sequence" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"model_name" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_conversation_summaries_sequence_check" CHECK ("chat_conversation_summaries"."summarized_through_sequence" > 0 AND "chat_conversation_summaries"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "chat_conversation_summaries" ADD CONSTRAINT "chat_conversation_summaries_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;