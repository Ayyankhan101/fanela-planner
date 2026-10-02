ALTER TABLE "pending_mfa" ADD COLUMN "purpose" text DEFAULT 'challenge' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recovery_codes" text;--> statement-breakpoint
ALTER TABLE "job_lines" ADD COLUMN "supplier_sku" text;