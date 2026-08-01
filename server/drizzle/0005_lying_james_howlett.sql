CREATE TABLE "company_profiles" (
	"opportunity_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"official_website_url" text,
	"favicon_data" text,
	"favicon_content_type" text,
	"error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_opportunity_id_job_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."job_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_profiles_status_updated_at_index" ON "company_profiles" USING btree ("status","updated_at");