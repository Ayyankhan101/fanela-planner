ALTER TABLE "stock_events" DROP CONSTRAINT "stock_events_job_line_id_job_lines_id_fk";
--> statement-breakpoint
ALTER TABLE "job_lines" ADD COLUMN "stock_ordered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_lines" ADD COLUMN "stock_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_lines" ADD COLUMN "stock_issue" text;--> statement-breakpoint
ALTER TABLE "swatch_attempts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE set null ON UPDATE no action;