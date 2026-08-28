import {
  buildApprovalCards,
  createGrant,
  keyAttributionsFromPolicy,
  runReconciliationFromJson,
  serviceAccountsFromPolicy,
  type ApprovalCard,
  type CreateGrantInput,
  type DirectoryEntry,
  type Grant,
  type KeyAttribution,
  type ReconciliationResult,
  type ServiceAccountPolicy,
} from "@keyring/core";
import { createFixtureConnector } from "@keyring/connectors";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPolicy } from "../policy/load.js";
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

/** Display names for fixture systems (5 in test-org; fan-out uses one subagent each). */
const SYSTEM_LABELS: Record<string, string> = {
  github: "GitHub",
  google_workspace: "Google Workspace",
  slack: "Slack",
  notion: "Notion",
  aws: "AWS",
};

export interface ConnectedSystem {
  id: string;
  displayName: string;
  /** Read-only inventory only — never exposes revoke. */
  mode: "scan";
}

export interface CompactGrant {
  id: string;
  system: string;
  capability: string;
  resource: { id: string; displayName: string; kind: string };
  principal: Grant["principal"];
  evidenceSources: string[];
  lastUsedAt?: string;
}

/**
 * Systems available to scan. Derived from fixture grant systems so a free
 * FixtureConnector run still fans out one subagent per connected system.
 */
export async function listConnectedSystems(): Promise<ConnectedSystem[]> {
  const grants = await loadFullFixtureGrants();
  const ids = [...new Set(grants.map((g) => g.system))].sort();
  return ids.map((id) => ({
    id,
    displayName: SYSTEM_LABELS[id] ?? id,
    mode: "scan" as const,
  }));
}

export function grantToCompact(grant: Grant): CompactGrant {
  return {
    id: grant.id,
    system: grant.system,
    capability: grant.capability,
    resource: {
      id: grant.resource.id,
      displayName: grant.resource.displayName,
      kind: grant.resource.kind,
    },
    principal: grant.principal,
    evidenceSources: grant.evidence.map((e) => e.source),
    ...(grant.lastUsedAt
      ? { lastUsedAt: grant.lastUsedAt.toISOString() }
      : {}),
  };
}

/**
 * Read-only inventory for one system. Uses FixtureConnector, then filters by
 * system id so raw multi-system JSON never floods a single context.
 * Deliberately has no access to WriteCredentials / revoke.
 */
export async function inventorySystem(
  systemId: string,
  opts: { delayMsPerGrant?: number; signal?: AbortSignal } = {},
): Promise<{ systemId: string; grants: CompactGrant[]; count: number }> {
  const connector = createFixtureConnector({
    fixturesDir: path.join(repoRoot, "fixtures/test-org"),
  });

  const grants: Grant[] = [];
  for await (const grant of connector.inventory({
    credentials: { kind: "read", token: "fixture-scan" },
    signal: opts.signal,
  })) {
    opts.signal?.throwIfAborted();
    if (grant.system !== systemId) continue;
    if (opts.delayMsPerGrant && opts.delayMsPerGrant > 0) {
      await sleep(opts.delayMsPerGrant, opts.signal);
    }
    grants.push(grant);
  }

  return {
    systemId,
    grants: grants.map(grantToCompact),
    count: grants.length,
  };
}

export async function loadDirectory(): Promise<DirectoryEntry[]> {
  const peopleDoc = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/test-org/people.json"), "utf8"),
  ) as {
    people: Array<{
      displayName: string;
      workEmail: string;
      personalEmail: string;
      githubUsername: string;
    }>;
  };
  return peopleDoc.people.map((p) => ({
    displayName: p.displayName,
    workEmails: [p.workEmail],
    personalEmails: [p.personalEmail],
    usernames: [p.githubUsername],
  }));
}

export async function loadFullFixtureGrants(): Promise<Grant[]> {
  const raw = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/test-org/grants.json"), "utf8"),
  ) as { grants: CreateGrantInput[] };
  return raw.grants.map((g) =>
    createGrant({
      ...g,
      discoveredAt: new Date(g.discoveredAt),
      ...(g.createdAt ? { createdAt: new Date(g.createdAt) } : {}),
      ...(g.lastUsedAt ? { lastUsedAt: new Date(g.lastUsedAt) } : {}),
    }),
  );
}

export function buildReconcileInputJson(
  grants: Grant[],
  directory: DirectoryEntry[],
  opts: {
    keyAttributions?: KeyAttribution[];
    serviceAccounts?: ServiceAccountPolicy[];
  } = {},
) {
  return {
    grants: grants.map((g) => ({
      ...g,
      discoveredAt: g.discoveredAt.toISOString(),
      ...(g.createdAt ? { createdAt: g.createdAt.toISOString() } : {}),
      ...(g.lastUsedAt ? { lastUsedAt: g.lastUsedAt.toISOString() } : {}),
    })),
    directory,
    ...(opts.keyAttributions?.length
      ? { keyAttributions: opts.keyAttributions }
      : {}),
    ...(opts.serviceAccounts?.length
      ? {
          serviceAccounts: opts.serviceAccounts.map((sa) => ({
            id: sa.id,
            displayName: sa.display_name,
            owner: sa.owner,
            keyIds: sa.key_ids,
            resourceIds: sa.resource_ids,
          })),
        }
      : {}),
  };
}

/**
 * Run the identity module (same code as the sandbox CLI) over merged grants.
 * Loads keyring.yml so declared service accounts attribute CI keys.
 */
export async function runIdentityReconciliation(mergedGrantIds?: string[]): Promise<{
  reconciliation: ReconciliationResult;
  grantCount: number;
  input: ReturnType<typeof buildReconcileInputJson>;
  policy: Awaited<ReturnType<typeof loadPolicy>>;
}> {
  const all = await loadFullFixtureGrants();
  const grants =
    mergedGrantIds && mergedGrantIds.length > 0
      ? all.filter((g) => mergedGrantIds.includes(g.id))
      : all;
  const directory = await loadDirectory();
  const policy = await loadPolicy();
  const input = buildReconcileInputJson(grants, directory, {
    keyAttributions: keyAttributionsFromPolicy(policy),
    serviceAccounts: serviceAccountsFromPolicy(policy),
  });
  const reconciliation = runReconciliationFromJson(input);
  return { reconciliation, grantCount: grants.length, input, policy };
}

export interface ScanPipelineResult {
  grants: Grant[];
  reconciliation: ReconciliationResult;
  cards: ApprovalCard[];
  systems: ConnectedSystem[];
}

/**
 * Full scan pipeline used by MCP tools / demo (no LLM).
 * Mirrors the agent flow: per-system inventory → reconcile → ApprovalCards.
 */
export async function runFixtureScanPipeline(
  opts: {
    personHint?: string;
    delayMsPerGrant?: number;
    signal?: AbortSignal;
  } = {},
): Promise<ScanPipelineResult> {
  const systems = await listConnectedSystems();
  const mergedIds: string[] = [];

  for (const system of systems) {
    const result = await inventorySystem(system.id, {
      delayMsPerGrant: opts.delayMsPerGrant,
      signal: opts.signal,
    });
    for (const g of result.grants) mergedIds.push(g.id);
  }

  const { reconciliation, grantCount, policy } =
    await runIdentityReconciliation(mergedIds);
  void grantCount;
  const grants = await loadFullFixtureGrants();
  let cards = buildApprovalCards({ grants, reconciliation, policy });
  if (opts.personHint) {
    const hint = opts.personHint.toLowerCase();
    cards = cards.filter((c) => {
      const ids = c.grant.principal.identifiers
        .map((i) => i.value.toLowerCase())
        .join(" ");
      const name = c.attribution.reasoning.toLowerCase();
      return ids.includes(hint) || name.includes(hint);
    });
  }

  return { grants, reconciliation, cards, systems };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

export { repoRoot };
