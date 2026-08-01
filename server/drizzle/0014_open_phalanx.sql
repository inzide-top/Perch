ALTER TABLE "review_documents" DROP CONSTRAINT "review_documents_interview_round_id_interview_rounds_id_fk";
--> statement-breakpoint
ALTER TABLE "review_documents" ADD CONSTRAINT "review_documents_interview_round_id_interview_rounds_id_fk" FOREIGN KEY ("interview_round_id") REFERENCES "public"."interview_rounds"("id") ON DELETE restrict ON UPDATE no action;