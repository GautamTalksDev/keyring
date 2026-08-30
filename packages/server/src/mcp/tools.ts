import {
  redactErrorMessage,
  redactSecrets,
  type ApprovalCard,
  type Grant,
  type ReconciliationResult,
} from "@keyring/core";
import { asApprovalCardId, buildApprovalCards, CI_TRAP_MARKER } from "@keyring/core";
import { z } from "zod";

import { persistScanOutcome } from "../agent/persist.js";
import {
  inventorySystem,
  limitDemoCards,
  listConnectedSystems,
  loadAllFixtureGrants,
  runIdentityReconciliation,
  type CompactGrant,
} from "../agent/scan.js";
import type { Database } from "../db/client.js";
import { appendChainedAudit, getApprovalCard, hasSuccessfulExecute } from "../db/store.js";
import { evidenceWithUndo, resolveExecuteDryRun, revokeGrant } from "../services/revoke-runtime.js";

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(redactSecrets(data), null, 2) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: redactErrorMessage(message) }],
    isError: true,
  };
}

/** Read-only scan tools — inventory never receives write credentials. */
export function scanToolDefs(): McpToolDef[] {
  return [
    {
      name: "list_connected_systems",
      description:
        "List connected systems to scan. Call once, then spawn ONE TrueForge subagent per system.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "inventory_system",
      description:
        "Read-only inventory for a single system. Returns a compact Grant list (not raw API JSON). Use from a per-system subagent only.",
      inputSchema: {
        type: "object",
        properties: {
          system_id: { type: "string", description: "System id from list_connected_systems" },
          delay_ms_per_grant: {
            type: "number",
            description: "Optional artificial delay for reconnect demos (ms per grant)",
          },
        },
        required: ["system_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "run_identity_reconciliation",
      description:
        "Execute the Keyring identity reconciliation module over merged grant ids (same code as the sandbox CLI). Prefer writing JSON + sandbox CLI when a TrueForge sandbox is provisioned; this tool is the identical module for fixture/stub runs.",
      inputSchema: {
        type: "object",
        properties: {
          grant_ids: {
            type: "array",
            items: { type: "string" },
            description: "Merged grant ids from all subagent inventories",
          },
          person_hint: {
            type: "string",
            description: "Optional person name/email to filter ApprovalCards",
          },
        },
        required: ["grant_ids"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "persist_approval_cards",
      description:
        "Persist grants and ApprovalCards after reconciliation. Does NOT revoke. Scan flow must STOP after this.",
      inputSchema: {
        type: "object",
        properties: {
          grant_ids: { type: "array", items: { type: "string" } },
          person_hint: { type: "string" },
          reconciliation: { type: "object", description: "Output of run_identity_reconciliation" },
        },
        required: ["grant_ids", "reconciliation"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
  ];
}

/** Mutating tools — harness must require approval. Unreachable credentials from scan inventory. */
export function mutateToolDefs(): McpToolDef[] {
  return [
    {
      name: "revoke_grant",
      description:
        "Revoke a grant AFTER human approval of an ApprovalCard. Never call during scan/audit. Requires write credentials held only by this mutate server. Idempotent: already-absent grants succeed. Honours KEYRING_EXECUTE_DRY_RUN (default ON).",
      inputSchema: {
        type: "object",
        properties: {
          grant_id: { type: "string" },
          approval_card_id: { type: "string" },
          approved_by: { type: "string" },
          dry_run: {
            type: "boolean",
            description: "Optional override. Default follows KEYRING_EXECUTE_DRY_RUN (ON).",
          },
        },
        required: ["grant_id", "approval_card_id", "approved_by"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
  ];
}

export async function handleScanTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { db: Database["db"] | null },
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    switch (name) {
      case "list_connected_systems": {
        const systems = await listConnectedSystems();
        return textResult({
          systems,
          instruction:
            "Spawn exactly one TrueForge subagent per system. Each subagent calls inventory_system once and returns compact grants only.",
        });
      }
      case "inventory_system": {
        const systemId = z.string().parse(args.system_id);
        const delay = z.number().optional().parse(args.delay_ms_per_grant);
        const result = await inventorySystem(systemId, {
          delayMsPerGrant: delay ?? Number(process.env.KEYRING_SCAN_DELAY_MS ?? 0),
        });
        return textResult(result);
      }
      case "run_identity_reconciliation": {
        const grantIds = z.array(z.string()).parse(args.grant_ids);
        const personHint = z.string().optional().parse(args.person_hint);
        const { reconciliation, grantCount, input, policy } =
          await runIdentityReconciliation(grantIds);
        const grants = (await loadAllFixtureGrants()).filter((g) => grantIds.includes(g.id));
        let cards = buildApprovalCards({ grants, reconciliation, policy });
        if (personHint) {
          const hint = personHint.toLowerCase();
          cards = cards.filter(
            (c) =>
              c.attribution.reasoning.toLowerCase().includes(hint) ||
              c.grant.principal.identifiers.some((i) => i.value.toLowerCase().includes(hint)) ||
              c.grant.principal.kind === "ai_agent",
          );
        }
        cards = limitDemoCards(cards);
        return textResult({
          grantCount,
          clusterCount: reconciliation.clusters.length,
          unknownCount: reconciliation.unknown.grantIds.length,
          reconciliation,
          cardsPreview: cards.slice(0, 8).map(cardPreview),
          cardCount: cards.length,
          ciTrapHeld: cards.some(
            (c) =>
              c.status === "held" && c.grant.evidence.some((e) => e.claim.includes(CI_TRAP_MARKER)),
          ),
          sandboxNote:
            "Identical to `node packages/core/dist/identity/cli.js` / skill sandbox CLI. Prefer sandbox file+CLI when provisioned.",
          reconcileInputBytes: JSON.stringify(input).length,
        });
      }
      case "persist_approval_cards": {
        const grantIds = z.array(z.string()).parse(args.grant_ids);
        const personHint = z.string().optional().parse(args.person_hint);
        const reconciliation = args.reconciliation as ReconciliationResult;
        const grants = (await loadAllFixtureGrants()).filter((g) => grantIds.includes(g.id));
        const { policy } = await runIdentityReconciliation(grantIds);
        let cards = buildApprovalCards({ grants, reconciliation, policy });
        if (personHint) {
          const hint = personHint.toLowerCase();
          cards = cards.filter(
            (c) =>
              c.attribution.reasoning.toLowerCase().includes(hint) ||
              c.grant.principal.identifiers.some((i) => i.value.toLowerCase().includes(hint)) ||
              c.grant.principal.kind === "ai_agent",
          );
        }
        cards = limitDemoCards(cards);
        const persisted = await persistScanOutcome(ctx.db, {
          grants,
          cards,
          reconciliation,
          hint: personHint,
        });
        return textResult({
          ...persisted,
          stop: true,
          message:
            "Scan complete. ApprovalCards persisted. Do NOT call revoke_grant. Stop and present the queue to the human.",
        });
      }
      default:
        return errorResult(`Unknown scan tool: ${name}`);
    }
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export async function handleMutateTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { db: Database["db"] | null } = { db: null },
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    if (name !== "revoke_grant") {
      return errorResult(`Unknown mutate tool: ${name}`);
    }
    const grantId = z.string().parse(args.grant_id);
    const approvalCardId = z.string().parse(args.approval_card_id);
    const approvedBy = z.string().parse(args.approved_by);
    const dryRun = resolveExecuteDryRun(
      typeof args.dry_run === "boolean" ? args.dry_run : undefined,
    );

    const card = ctx.db ? await getApprovalCard(ctx.db, approvalCardId) : null;
    const grant = card?.grant ?? (await loadAllFixtureGrants()).find((g) => g.id === grantId);

    if (!grant) {
      return errorResult(`Grant not found: ${grantId}`);
    }
    if (grantId !== grant.id) {
      return errorResult(`grant_id ${grantId} does not match card grant ${grant.id}`);
    }
    if (grant.evidence.some((e) => e.claim.includes(CI_TRAP_MARKER))) {
      return errorResult(
        `Refusing revoke: grant is marked ${CI_TRAP_MARKER} (CI infrastructure trap).`,
      );
    }

    if (ctx.db && (await hasSuccessfulExecute(ctx.db, approvalCardId))) {
      return textResult({
        grantId,
        approvalCardId,
        approvedBy,
        skipped: true,
        reason: "already_executed",
      });
    }

    const approvedAt = card?.decision?.at ?? new Date();
    const beforeAt = new Date();

    if (ctx.db) {
      await appendChainedAudit(ctx.db, {
        cardId: asApprovalCardId(approvalCardId),
        action: "execute_revoke",
        approvedBy,
        approvedAt,
        executedAt: beforeAt,
        result: "partial",
        error: dryRun ? "dry_run_attempt_started" : "attempt_started",
        evidenceSnapshot: grant.evidence,
      });
    }

    const result = await revokeGrant({
      grant,
      approvedBy,
      approvalCardId,
      dryRun,
    });

    const afterAt = new Date();
    const afterResult = !result.ok
      ? ("failed" as const)
      : dryRun
        ? ("partial" as const)
        : ("success" as const);
    const afterError = !result.ok ? result.error : dryRun ? "dry_run" : undefined;

    if (ctx.db) {
      await appendChainedAudit(ctx.db, {
        cardId: asApprovalCardId(approvalCardId),
        action: "execute_revoke",
        approvedBy,
        approvedAt,
        executedAt: afterAt,
        result: afterResult,
        ...(afterError ? { error: afterError } : {}),
        evidenceSnapshot: evidenceWithUndo(
          grant.evidence,
          result.ok ? result.undoHint : undefined,
          result.ok ? result.detail : undefined,
        ),
      });
    }

    return textResult({
      grantId,
      approvalCardId,
      approvedBy,
      dryRun,
      result,
      ledger: afterResult,
    });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

function cardPreview(card: ApprovalCard) {
  return {
    id: card.id,
    grantId: card.grant.id,
    system: card.grant.system,
    capability: card.grant.capability,
    risk: card.risk.score,
    proposedAction: card.proposedAction.kind,
    status: card.status,
    attribution: {
      confidence: card.attribution.confidence,
      resolvedTo: card.attribution.resolvedTo ?? null,
    },
  };
}

export type { CompactGrant, Grant };
