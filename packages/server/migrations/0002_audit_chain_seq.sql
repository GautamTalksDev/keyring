ALTER TABLE "audit_records" ADD COLUMN IF NOT EXISTS "seq" bigserial;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "audit_records"
    ADD CONSTRAINT "audit_records_seq_unique" UNIQUE ("seq");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "audit_records"
    ADD CONSTRAINT "audit_records_prev_hash_unique" UNIQUE ("prev_hash");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
