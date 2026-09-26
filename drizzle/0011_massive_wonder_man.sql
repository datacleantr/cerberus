ALTER TABLE "scraped_products" ADD COLUMN "source_sku" text;--> statement-breakpoint
ALTER TABLE "scraped_products" ADD COLUMN "gtin" text;--> statement-breakpoint
ALTER TABLE "scraped_products" ADD COLUMN "mpn" text;--> statement-breakpoint
ALTER TABLE "scraped_products" ADD COLUMN "baseline_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "scraped_products" ADD COLUMN "baseline_at" timestamp;--> statement-breakpoint
ALTER TABLE "scraped_products" ADD COLUMN "first_below_baseline_at" timestamp;--> statement-breakpoint
ALTER TABLE "scraped_products" ADD COLUMN "last_price_change_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "scraped_products_gtin_domain_uniq" ON "scraped_products" USING btree ("gtin","source_domain");--> statement-breakpoint
ALTER TABLE "scraped_products" ADD CONSTRAINT "scraped_products_gtin_digits" CHECK ("scraped_products"."gtin" is null or "scraped_products"."gtin" ~ '^[0-9]{8}$|^[0-9]{12}$|^[0-9]{13}$|^[0-9]{14}$');