CREATE TABLE "routine_completions" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_code" text NOT NULL,
	"routine_id" text NOT NULL,
	"frequency" text NOT NULL,
	"period_key" text NOT NULL,
	"completed_by" text NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "routine_completions_frequency_enum" CHECK ("routine_completions"."frequency" in ('DAILY','WEEKLY','MONTHLY'))
);
--> statement-breakpoint
CREATE TABLE "store_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_code" text,
	"asset_type" text NOT NULL,
	"name" text NOT NULL,
	"provider" text,
	"url" text,
	"expires_at" timestamp,
	"renewal_cost" numeric(10, 2),
	"notes" text,
	"last_checked_at" timestamp,
	"last_checked_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_assets_type_enum" CHECK ("store_assets"."asset_type" in ('SUBSCRIPTION','DOMAIN','HOSTING','SHOPIFY_SITE','OTHER'))
);
--> statement-breakpoint
ALTER TABLE "routine_completions" ADD CONSTRAINT "routine_completions_store_code_stores_store_code_fk" FOREIGN KEY ("store_code") REFERENCES "public"."stores"("store_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_assets" ADD CONSTRAINT "store_assets_store_code_stores_store_code_fk" FOREIGN KEY ("store_code") REFERENCES "public"."stores"("store_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "routine_completions_uq" ON "routine_completions" USING btree ("store_code","routine_id","period_key");--> statement-breakpoint
CREATE INDEX "routine_completions_store_idx" ON "routine_completions" USING btree ("store_code");--> statement-breakpoint
CREATE INDEX "store_assets_store_idx" ON "store_assets" USING btree ("store_code");