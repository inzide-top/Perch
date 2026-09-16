CREATE TABLE "user_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_feedback_user_id_created_at_index" ON "user_feedback" USING btree ("user_id","created_at");