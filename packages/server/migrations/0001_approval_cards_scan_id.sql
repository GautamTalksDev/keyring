ALTER TABLE "approval_cards" ADD COLUMN IF NOT EXISTS "scan_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_cards_scan_id_idx" ON "approval_cards" ("scan_id");
