import { createGrant, type CreateGrantInput, type Grant } from "@keyring/core";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  Connector,
  ConnectorCapabilities,
  InventoryContext,
  RevokeContext,
  RevokeResult,
} from "./types.js";
import { buildUndoHint } from "./revoke-utils.js";

const defaultFixturesDir = fileURLToPath(new URL("../fixtures", import.meta.url));

export interface FixtureConnectorOptions {
  /** Directory of grant fixture JSON files. Defaults to package `fixtures/`. */
  fixturesDir?: string;
}

type FixtureFile = CreateGrantInput | { grants: CreateGrantInput[] };

/** Only grant datasets — skip people.json / manifest.json in the same folder. */
function isGrantFixtureFile(name: string): boolean {
  return (
    name === "grants.json" ||
    name.endsWith("-grants.json") ||
    name.endsWith(".grants.json")
  );
}

function isGrantInput(value: unknown): value is CreateGrantInput {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.system === "string" &&
    typeof v.capability === "string" &&
    v.principal !== undefined &&
    v.resource !== undefined &&
    Array.isArray(v.evidence)
  );
}

function reviveDates(input: CreateGrantInput): CreateGrantInput {
  return {
    ...input,
    discoveredAt: new Date(input.discoveredAt),
    ...(input.createdAt !== undefined
      ? { createdAt: new Date(input.createdAt) }
      : {}),
    ...(input.lastUsedAt !== undefined
      ? { lastUsedAt: new Date(input.lastUsedAt) }
      : {}),
  };
}

async function loadGrantsFromDir(dir: string): Promise<Grant[]> {
  const entries = await readdir(dir);
  const jsonFiles = entries.filter(isGrantFixtureFile).sort();
  const grants: Grant[] = [];

  for (const file of jsonFiles) {
    const raw = await readFile(path.join(dir, file), "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (!isGrantInput(item)) {
          throw new Error(`Invalid grant fixture entry in ${file}`);
        }
        grants.push(createGrant(reviveDates(item)));
      }
      continue;
    }

    if (parsed !== null && typeof parsed === "object" && "grants" in parsed) {
      const fileBody = parsed as FixtureFile;
      if (!("grants" in fileBody) || !Array.isArray(fileBody.grants)) {
        throw new Error(`Invalid grants array in ${file}`);
      }
      for (const item of fileBody.grants) {
        if (!isGrantInput(item)) {
          throw new Error(`Invalid grant fixture entry in ${file}`);
        }
        grants.push(createGrant(reviveDates(item)));
      }
      continue;
    }

    if (!isGrantInput(parsed)) {
      throw new Error(`Invalid grant fixture file ${file}`);
    }
    grants.push(createGrant(reviveDates(parsed)));
  }

  return grants;
}

/**
 * Demo / test connector: yields grants from JSON fixtures.
 * No live credentials or paid model required.
 *
 * `inventory` is read-only by construction (InventoryContext only).
 * `revoke` is a no-op success when capabilities.canRevoke is true for demos.
 */
export function createFixtureConnector(
  options: FixtureConnectorOptions = {},
): Connector {
  const fixturesDir = options.fixturesDir ?? defaultFixturesDir;

  return {
    id: "fixture",
    displayName: "Fixture (JSON)",

    async *inventory(ctx: InventoryContext): AsyncIterable<Grant> {
      // Credentials are read-scoped; discard unused to satisfy noUnusedParameters
      // while documenting that inventory never needs write tokens.
      void ctx.credentials.kind;
      if (ctx.credentials.kind !== "read") {
        // Unreachable if types are respected; defensive for JS callers.
        throw new Error("inventory requires ReadCredentials (kind: 'read')");
      }

      const grants = await loadGrantsFromDir(fixturesDir);
      for (const grant of grants) {
        ctx.signal?.throwIfAborted();
        yield grant;
      }
    },

    async revoke(grant: Grant, ctx: RevokeContext): Promise<RevokeResult> {
      if (ctx.credentials.kind !== "write") {
        throw new Error("revoke requires WriteCredentials (kind: 'write')");
      }

      const restorable = grant.revocable.possible && grant.revocable.reversible;
      const undoHint = restorable
        ? buildUndoHint({
            system: grant.system,
            permission: grant.capability,
            restoreMethod: `restore_via_${grant.revocable.method}`,
            params: {
              grantId: grant.id,
              resourceId: grant.resource.id,
              principal: grant.principal.identifiers,
              capability: grant.capability,
            },
          })
        : undefined;

      const prefix = ctx.dryRun ? "dry_run: would revoke" : "fixture revoke";
      return {
        ok: true,
        detail: `${prefix} ${grant.id} (approval ${ctx.approvalCardId} by ${ctx.approvedBy})`,
        ...(undoHint ? { undoHint } : {}),
      };
    },

    capabilities(): ConnectorCapabilities {
      return {
        canRevoke: true,
        canDowngrade: false,
        reportsLastUsed: true,
      };
    },
  };
}
