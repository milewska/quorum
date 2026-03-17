ALTER TABLE "events" ADD COLUMN "cost_tiers_json" text;--> statement-breakpoint
ALTER TABLE "commitments" ADD COLUMN "tier_label" text;--> statement-breakpoint
ALTER TABLE "commitments" ADD COLUMN "tier_amount" integer;
