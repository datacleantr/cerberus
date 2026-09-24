ALTER TABLE "orders" ADD COLUMN "approval_status" text DEFAULT 'AUTO_APPROVED' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "purchase_approval_threshold" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_approval_status_enum" CHECK ("orders"."approval_status" in
    ('AUTO_APPROVED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'));