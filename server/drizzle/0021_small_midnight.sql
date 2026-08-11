CREATE EXTENSION IF NOT EXISTS "vector";
--> statement-breakpoint
CREATE TABLE "chat_memory_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"scope_type" text NOT NULL,
	"opportunity_ids" jsonb NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_memory_documents_chunk_index_check" CHECK ("chunk_index" >= 0),
	CONSTRAINT "chat_memory_documents_scope_check" CHECK (("scope_type" = 'global' AND jsonb_array_length("opportunity_ids") = 0) OR ("scope_type" = 'opportunity' AND jsonb_array_length("opportunity_ids") > 0))
);
--> statement-breakpoint
ALTER TABLE "chat_memory_documents" ADD CONSTRAINT "chat_memory_documents_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_memory_documents" ADD CONSTRAINT "chat_memory_documents_run_id_chat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."chat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_memory_documents_run_id_chunk_index_unique" ON "chat_memory_documents" USING btree ("run_id","chunk_index");--> statement-breakpoint
CREATE INDEX "chat_memory_documents_user_model_index" ON "chat_memory_documents" USING btree ("user_id","embedding_model");--> statement-breakpoint
CREATE INDEX "chat_memory_documents_conversation_id_index" ON "chat_memory_documents" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "chat_memory_documents_opportunity_ids_index" ON "chat_memory_documents" USING gin ("opportunity_ids");--> statement-breakpoint
CREATE INDEX "chat_memory_documents_embedding_hnsw_index" ON "chat_memory_documents" USING hnsw ("embedding" vector_cosine_ops);
