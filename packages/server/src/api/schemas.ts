import { z } from "zod";

export const createScanBodySchema = z
  .object({
    person: z.string().min(1).max(200).optional(),
    scope: z.string().min(1).max(200).optional(),
    /** Override driver; default from KEYRING_SCAN_DRIVER env. */
    driver: z.enum(["fixture", "trueforge", "record", "replay"]).optional(),
    /** Recording id for record/replay (defaults from person slug). */
    recordingId: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/)
      .optional(),
    /** When driver=record, optionally record a TrueForge live turn. */
    recordWith: z.enum(["fixture", "trueforge"]).optional(),
    /** Artificial delay per grant for demo/tests (fixture driver). */
    delayMsPerGrant: z.number().int().min(0).max(30_000).optional(),
    /**
     * Re-audit mode: diff against the previous completed scan and
     * (when policy/env say so) only surface changed grants.
     */
    reaudit: z.boolean().optional(),
    /** Override: only keep cards for added/changed grants. */
    diffOnly: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => {
      if (v.driver === "replay") return Boolean(v.recordingId || v.person);
      if (v.reaudit) return true;
      return Boolean(v.person || v.scope);
    },
    {
      message: "person or scope is required (replay needs recordingId or person; reaudit may omit)",
    },
  );

export type CreateScanBody = z.infer<typeof createScanBodySchema>;

export const cardDecisionBodySchema = z
  .object({
    decision: z.enum(["approve", "hold", "reject"]),
    note: z.string().max(2000).optional(),
    /** Who is recording intent — never executes. */
    by: z.string().min(1).max(200).default("operator"),
    /**
     * When true (bulk approve from the UI), protected cards are rejected.
     * Individual approvals omit this and are always allowed.
     */
    bulk: z.boolean().optional(),
  })
  .strict();

export type CardDecisionBody = z.infer<typeof cardDecisionBodySchema>;

export const executeScanBodySchema = z
  .object({
    approvedBy: z.string().min(1).max(200).default("operator"),
    /**
     * When true (default via KEYRING_EXECUTE_DRY_RUN=1), walk the execute path
     * and write ledger entries without calling mutating APIs.
     * Pass false explicitly to revoke for real.
     */
    dryRun: z.boolean().optional(),
  })
  .strict();

export type ExecuteScanBody = z.infer<typeof executeScanBodySchema>;

export const executeScanQuerySchema = z
  .object({
    stream: z.enum(["1"]).optional(),
  })
  .strict();

export const auditQuerySchema = z
  .object({
    cardId: z.string().min(1).optional(),
    action: z
      .enum([
        "approve",
        "reject",
        "hold",
        "execute_revoke",
        "execute_downgrade",
        "execute_transfer",
        "flag",
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditExportQuerySchema = z
  .object({
    format: z.enum(["json", "csv"]).default("json"),
    cardId: z.string().min(1).optional(),
  })
  .strict();

export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>;

export const scanIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const cardIdParamSchema = z
  .object({
    id: z.string().min(1).max(200),
  })
  .strict();
