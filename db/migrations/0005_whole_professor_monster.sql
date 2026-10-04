ALTER TABLE "integration_outbox" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "claimed_at" timestamp with time zone;