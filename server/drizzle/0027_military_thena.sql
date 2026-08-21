CREATE TABLE "capability_jd_signal_embeddings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_id" uuid NOT NULL,
	"signal_type" text NOT NULL,
	"signal_index" integer NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "capability_jd_signal_embeddings_signal_index_check" CHECK ("capability_jd_signal_embeddings"."signal_index" >= 0),
	CONSTRAINT "capability_jd_signal_embeddings_signal_type_check" CHECK ("capability_jd_signal_embeddings"."signal_type" IN ('strength', 'gap'))
);
--> statement-breakpoint
ALTER TABLE "capability_jd_signal_embeddings" ADD CONSTRAINT "capability_jd_signal_embeddings_analysis_id_job_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."job_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capability_jd_signal_embeddings_analysis_type_index_unique" ON "capability_jd_signal_embeddings" USING btree ("analysis_id","signal_type","signal_index");--> statement-breakpoint
CREATE INDEX "capability_jd_signal_embeddings_analysis_id_index" ON "capability_jd_signal_embeddings" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "capability_jd_signal_embeddings_model_index" ON "capability_jd_signal_embeddings" USING btree ("embedding_model");