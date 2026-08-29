import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Drizzle schema for Keyring product storage.
 * Domain shapes live in @keyring/core; columns store JSON snapshots where needed.
 */

export const grants = pgTable("grants", {
  id: text("id").primaryKey(),
  system: text("system").notNull(),
  principal: jsonb("principal").notNull(),
  resource: jsonb("resource").notNull(),
  capability: text("capability").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull(),
  revocable: jsonb("revocable").notNull(),
  evidence: jsonb("evidence").notNull(),
  insertedAt: timestamp("inserted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const approvalCards = pgTable("approval_cards", {
  id: text("id").primaryKey(),
  grantId: text("grant_id")
    .notNull()
    .references(() => grants.id),
  scanId: text("scan_id"),
  grantSnapshot: jsonb("grant_snapshot").notNull(),
  proposedAction: jsonb("proposed_action").notNull(),
  irreversible: boolean("irreversible").notNull(),
  risk: jsonb("risk").notNull(),
  attribution: jsonb("attribution").notNull(),
  status: text("status").notNull(),
  decision: jsonb("decision"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only ledger. UPDATE/DELETE are rejected by a Postgres trigger
 * (see migrations) — not only by application code.
 */
export const auditRecords = pgTable("audit_records", {
  id: text("id").primaryKey(),
  cardId: text("card_id").notNull(),
  action: text("action").notNull(),
  approvedBy: text("approved_by").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
  result: text("result").notNull(),
  error: text("error"),
  evidenceSnapshot: jsonb("evidence_snapshot").notNull(),
  prevHash: text("prev_hash").notNull().unique(),
  hash: text("hash").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  /** Monotonic insert order. recordedAt is not unique at millisecond resolution. */
  seq: bigserial("seq", { mode: "number" }).notNull(),
});

export const scanRuns = pgTable("scan_runs", {
  id: text("id").primaryKey(),
  connectorId: text("connector_id").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  grantsDiscovered: integer("grants_discovered").notNull().default(0),
  error: text("error"),
  metadata: jsonb("metadata"),
});

export type GrantRow = typeof grants.$inferSelect;
export type ApprovalCardRow = typeof approvalCards.$inferSelect;
export type AuditRecordRow = typeof auditRecords.$inferSelect;
export type ScanRunRow = typeof scanRuns.$inferSelect;
