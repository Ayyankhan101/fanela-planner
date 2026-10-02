CREATE TYPE "public"."role_key" AS ENUM('admin', 'ops', 'office', 'director', 'dispatch', 'packing', 'dept');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('open', 'in_production', 'part_dispatched', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('bulk', 'pod', 'repeat', 'sample');--> statement-breakpoint
CREATE TYPE "public"."readiness" AS ENUM('white', 'amber', 'green');--> statement-breakpoint
CREATE TYPE "public"."stage_status" AS ENUM('waiting', 'ready', 'in_progress', 'blocked', 'completed');--> statement-breakpoint
CREATE TYPE "public"."stock_event_type" AS ENUM('receipt', 'adjustment', 'correction', 'line_removed', 'archived', 'update');--> statement-breakpoint
CREATE TYPE "public"."artwork_status" AS ENUM('draft', 'awaiting', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."swatch_status" AS ENUM('draft', 'in_progress', 'awaiting', 'approved', 'rejected', 're_swatch');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('draft', 'booking_arranged', 'booked', 'labels_attached', 'print_requested', 'labels_printed', 'dispatched', 'collected', 'void');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('created', 'parsed', 'validated', 'previewed', 'confirmed', 'executed', 'failed', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "departments_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"ip" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"success" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_mfa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" "role_key" NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"ua" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_departments" (
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"billing_address" text,
	"default_dispatch_address" text,
	"default_dispatch_method" text,
	"account_ref" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "customers_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
CREATE TABLE "product_skus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"product_id" uuid NOT NULL,
	"master_sku" text NOT NULL,
	"supplier_sku" text,
	"colour" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "product_skus_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "product_skus_master_sku_unique" UNIQUE("master_sku")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "products_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
CREATE TABLE "job_contact_snapshot" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"address" text
);
--> statement-breakpoint
CREATE TABLE "job_dispatch_snapshot" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"method" text,
	"address" text,
	"instructions" text
);
--> statement-breakpoint
CREATE TABLE "job_line_sizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_line_id" uuid NOT NULL,
	"size" text NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"job_id" uuid NOT NULL,
	"product_sku_id" uuid,
	"sku_text" text,
	"colour" text,
	"qty_ordered" integer DEFAULT 0 NOT NULL,
	"unit_price" text,
	"tax" text,
	"buying_cost" text,
	"stock_status" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "job_lines_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
CREATE TABLE "job_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"job_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"status" "stage_status" DEFAULT 'waiting' NOT NULL,
	"process_date" date,
	"qty" integer DEFAULT 0 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"remaining" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"waste" integer DEFAULT 0 NOT NULL,
	"reprint_qty" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"completed_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "job_stages_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"job_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"po" text,
	"print_name" text,
	"order_date" date,
	"order_type" "order_type",
	"priority" integer DEFAULT 50 NOT NULL,
	"staff" text,
	"process_date" date,
	"dispatch_date" date,
	"dispatch_time" text,
	"status" "job_status" DEFAULT 'open' NOT NULL,
	"readiness_cache" "readiness",
	"archived" boolean DEFAULT false NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "jobs_job_number_unique" UNIQUE("job_number")
);
--> statement-breakpoint
CREATE TABLE "print_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"job_id" uuid NOT NULL,
	"name" text NOT NULL,
	"pieces" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "print_positions_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
CREATE TABLE "screen_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"required" integer,
	"made" integer,
	"confirmed" boolean DEFAULT false NOT NULL,
	"not_required" boolean DEFAULT false NOT NULL,
	"positions" jsonb,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "screen_records_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "stock_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"job_id" uuid,
	"job_line_id" uuid,
	"type" "stock_event_type" NOT NULL,
	"qty" integer,
	"reason" text,
	"payload" text,
	"corrects_event_id" uuid,
	"user_id" uuid,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_events_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
CREATE TABLE "artwork_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_version_id" uuid NOT NULL,
	"file_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artwork_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_version_id" uuid,
	"action" text NOT NULL,
	"actor" uuid,
	"reason" text,
	"before" text,
	"after" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artwork_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"proof_ref" text,
	"status" "artwork_status" DEFAULT 'draft' NOT NULL,
	"pantone_notes" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artworks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"job_id" uuid NOT NULL,
	"kind" text,
	"current_version_id" uuid,
	CONSTRAINT "artworks_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "artworks_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "swatch_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"file_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swatch_attempt_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor" uuid,
	"reason" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swatch_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"job_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"status" "swatch_status" DEFAULT 'draft' NOT NULL,
	"sample_qty" integer,
	"emb_file_ref" text,
	"thread_colours" text,
	"stitch_count" integer,
	"placement" text,
	"machine" text,
	"notes" text,
	"started_by" uuid,
	"started_at" timestamp with time zone,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swatch_attempts_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
CREATE TABLE "swatch_requirements" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"waived_by" uuid,
	"waived_reason" text,
	"waived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"mime" text,
	"checksum" text,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"immutable" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"shipment_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text,
	"confirmed_printed" boolean,
	CONSTRAINT "shipment_attachments_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor" uuid,
	"reason" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"job_id" uuid NOT NULL,
	"method" text NOT NULL,
	"status" "shipment_status" DEFAULT 'draft' NOT NULL,
	"parcels" integer,
	"consignment" text,
	"tracking" text,
	"booked_by" uuid,
	"booked_at" timestamp with time zone,
	"label_printed" boolean DEFAULT false NOT NULL,
	"print_requests" integer DEFAULT 0 NOT NULL,
	"reprints" integer DEFAULT 0 NOT NULL,
	"voided" boolean DEFAULT false NOT NULL,
	"void_reason" text,
	"final_at" timestamp with time zone,
	"finalized_by" uuid,
	"booking_fields" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"file_id" uuid,
	"status" "import_batch_status" DEFAULT 'created' NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"result" jsonb,
	"actor" uuid,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"job_id" uuid,
	"action" text NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_audit_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
ALTER TABLE "pending_mfa" ADD CONSTRAINT "pending_mfa_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_skus" ADD CONSTRAINT "product_skus_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_contact_snapshot" ADD CONSTRAINT "job_contact_snapshot_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_dispatch_snapshot" ADD CONSTRAINT "job_dispatch_snapshot_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_line_sizes" ADD CONSTRAINT "job_line_sizes_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lines" ADD CONSTRAINT "job_lines_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lines" ADD CONSTRAINT "job_lines_product_sku_id_product_skus_id_fk" FOREIGN KEY ("product_sku_id") REFERENCES "public"."product_skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stages" ADD CONSTRAINT "job_stages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stages" ADD CONSTRAINT "job_stages_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_positions" ADD CONSTRAINT "print_positions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_records" ADD CONSTRAINT "screen_records_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_assets" ADD CONSTRAINT "artwork_assets_artwork_version_id_artwork_versions_id_fk" FOREIGN KEY ("artwork_version_id") REFERENCES "public"."artwork_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_assets" ADD CONSTRAINT "artwork_assets_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_events" ADD CONSTRAINT "artwork_events_artwork_version_id_artwork_versions_id_fk" FOREIGN KEY ("artwork_version_id") REFERENCES "public"."artwork_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_events" ADD CONSTRAINT "artwork_events_actor_users_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swatch_assets" ADD CONSTRAINT "swatch_assets_attempt_id_swatch_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."swatch_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swatch_assets" ADD CONSTRAINT "swatch_assets_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swatch_attempt_events" ADD CONSTRAINT "swatch_attempt_events_attempt_id_swatch_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."swatch_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swatch_attempt_events" ADD CONSTRAINT "swatch_attempt_events_actor_users_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swatch_attempts" ADD CONSTRAINT "swatch_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swatch_attempts" ADD CONSTRAINT "swatch_attempts_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swatch_attempts" ADD CONSTRAINT "swatch_attempts_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swatch_attempts" ADD CONSTRAINT "swatch_attempts_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swatch_requirements" ADD CONSTRAINT "swatch_requirements_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swatch_requirements" ADD CONSTRAINT "swatch_requirements_waived_by_users_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_attachments" ADD CONSTRAINT "shipment_attachments_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_attachments" ADD CONSTRAINT "shipment_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_actor_users_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_booked_by_users_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_actor_users_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_audit" ADD CONSTRAINT "operational_audit_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_audit" ADD CONSTRAINT "operational_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_attempts_email_ts" ON "login_attempts" USING btree ("email","ts");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_ts" ON "login_attempts" USING btree ("ip","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_pk" ON "role_permissions" USING btree ("role_id","permission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "user_departments_pk" ON "user_departments" USING btree ("user_id","department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_pk" ON "user_roles" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "product_skus_supplier_idx" ON "product_skus" USING btree ("supplier_sku");--> statement-breakpoint
CREATE UNIQUE INDEX "job_line_sizes_pk" ON "job_line_sizes" USING btree ("job_line_id","size");--> statement-breakpoint
CREATE INDEX "job_lines_job_idx" ON "job_lines" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_lines_sku_text_idx" ON "job_lines" USING btree ("sku_text");--> statement-breakpoint
CREATE UNIQUE INDEX "job_stages_job_dept" ON "job_stages" USING btree ("job_id","department_id");--> statement-breakpoint
CREATE INDEX "job_stages_job_idx" ON "job_stages" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_customer_idx" ON "jobs" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "jobs_queue_idx" ON "jobs" USING btree ("dispatch_date","priority","process_date");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "print_positions_job_idx" ON "print_positions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "stock_events_job_ts" ON "stock_events" USING btree ("job_id","ts");--> statement-breakpoint
CREATE INDEX "stock_events_line_ts" ON "stock_events" USING btree ("job_line_id","ts");--> statement-breakpoint
CREATE INDEX "artwork_events_version_ts" ON "artwork_events" USING btree ("artwork_version_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "artwork_versions_unique" ON "artwork_versions" USING btree ("artwork_id","version");--> statement-breakpoint
CREATE INDEX "swatch_attempt_events_attempt_ts" ON "swatch_attempt_events" USING btree ("attempt_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "swatch_attempts_job_no" ON "swatch_attempts" USING btree ("job_id","attempt_no");--> statement-breakpoint
CREATE INDEX "files_entity_idx" ON "files" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_attachments_unique" ON "shipment_attachments" USING btree ("shipment_id","file_id");--> statement-breakpoint
CREATE INDEX "shipment_events_shipment_ts" ON "shipment_events" USING btree ("shipment_id","ts");--> statement-breakpoint
CREATE INDEX "shipments_job_idx" ON "shipments" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "outbox_status_ts" ON "integration_outbox" USING btree ("status","ts");--> statement-breakpoint
CREATE INDEX "audit_job_ts" ON "operational_audit" USING btree ("job_id","ts");--> statement-breakpoint
CREATE INDEX "audit_entity_ts" ON "operational_audit" USING btree ("entity_type","entity_id","ts");