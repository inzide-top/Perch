CREATE TABLE "user_model_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"encrypted_payload" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_model_settings" ENABLE ROW LEVEL SECURITY;