CREATE TABLE IF NOT EXISTS "grants" (
  "id" text PRIMARY KEY NOT NULL,
  "system" text NOT NULL,
  "principal" jsonb NOT NULL,
  "resource" jsonb NOT NULL,
  "capability" text NOT NULL,
  "created_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "discovered_at" timestamp with time zone NOT NULL,
  "revocable" jsonb NOT NULL,
  "evidence" jsonb NOT NULL,
  "inserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_cards" (
  "id" text PRIMARY KEY NOT NULL,
  "grant_id" text NOT NULL,
  "grant_snapshot" jsonb NOT NULL,
  "proposed_action" jsonb NOT NULL,
  "irreversible" boolean NOT NULL,
  "risk" jsonb NOT NULL,
  "attribution" jsonb NOT NULL,
  "status" text NOT NULL,
  "decision" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_records" (
  "id" text PRIMARY KEY NOT NULL,
  "card_id" text NOT NULL,
  "action" text NOT NULL,
  "approved_by" text NOT NULL,
  "approved_at" timestamp with time zone NOT NULL,
  "executed_at" timestamp with time zone NOT NULL,
  "result" text NOT NULL,
  "error" text,
  "evidence_snapshot" jsonb NOT NULL,
  "prev_hash" text NOT NULL,
  "hash" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scan_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "connector_id" text NOT NULL,
  "status" text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "grants_discovered" integer DEFAULT 0 NOT NULL,
  "error" text,
  "metadata" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "approval_cards"
    ADD CONSTRAINT "approval_cards_grant_id_grants_id_fk"
    FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_audit_records_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_records is append-only: % not allowed', TG_OP;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_records_append_only ON audit_records;
--> statement-breakpoint
CREATE TRIGGER audit_records_append_only
  BEFORE UPDATE OR DELETE ON audit_records
  FOR EACH ROW
  EXECUTE FUNCTION reject_audit_records_mutation();
