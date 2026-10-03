ALTER TABLE "import_batches" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "parsed" jsonb;