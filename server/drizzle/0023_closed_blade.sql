CREATE TABLE "resume_pdf_import_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"file_name" text NOT NULL,
	"page_count" integer NOT NULL,
	"character_count" integer NOT NULL,
	"extracted_text" text,
	"result" jsonb,
	"error" jsonb,
	"model_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "resume_pdf_import_tasks_user_id_updated_at_index" ON "resume_pdf_import_tasks" USING btree ("user_id","updated_at");