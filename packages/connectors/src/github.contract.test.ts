import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGitHubConnector } from "./github/connector.js";
import { createFixtureMcpToolCaller } from "./mcp/fixture-caller.js";
import type { InventoryContext } from "./types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DISCOVERED_AT = new Date("2026-08-24T17:00:00.000Z");

async function loadFixtureGithubGrants() {
  const raw = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/test-org/grants.json"), "utf8"),
  ) as { grants: Array<Record<string, unknown>> };
  return raw.grants.filter((g) => g.system === "github");
}

describe("GitHubConnector contract (MCP fixtures)", () => {
  it("inventories repos, collaborators, commit emails, and deploy keys via MCP", async () => {
    const connector = createGitHubConnector({
      org: "keyring-test",
      discoveredAt: DISCOVERED_AT,
    });
    const ctx: InventoryContext = {
      credentials: { kind: "read", token: "unused-mcp-owns-auth" },
      mcp: createFixtureMcpToolCaller(),
    };

    const grants = [];
    for await (const g of connector.inventory(ctx)) {
      grants.push(g);
    }

    expect(grants.length).toBeGreaterThanOrEqual(4);
    expect(
      grants.every((g) =>
        g.evidence.every((e) => e.source.startsWith("mcp:github/")),
      ),
    ).toBe(true);

    const byRepo = grants.filter((g) => g.resource.kind === "repo");
    const logins = byRepo.flatMap((g) =>
      g.principal.identifiers.filter((i) => i.kind === "username").map((i) => i.value),
    );
    expect(logins).toEqual(
      expect.arrayContaining(["analyticalengine", "cobol-compiler", "bombe-ops"]),
    );

    const commitEmails = byRepo.flatMap((g) =>
      g.principal.identifiers.filter((i) => i.kind === "commit_email"),
    );
    expect(commitEmails.map((i) => i.value).sort()).toEqual(
      expect.arrayContaining([
        "ada@keyring-test.example",
        "grace@keyring-test.example",
        "alan@keyring-test.example",
      ]),
    );

    const trap = grants.find((g) =>
      g.principal.identifiers.some(
        (i) => i.kind === "key_id" && i.value === "AKIA_KEYRING_CI_ORPHAN_LOOKALIKE",
      ),
    );
    expect(trap).toBeDefined();
    expect(trap!.resource.id).toBe("keyring-test/payments");
    expect(trap!.capability).toBe("admin");
  });

  it("covers every GitHub grant resource from the test-org fixtures", async () => {
    const fixtureGrants = await loadFixtureGithubGrants();
    const connector = createGitHubConnector({
      org: "keyring-test",
      discoveredAt: DISCOVERED_AT,
    });
    const grants = [];
    for await (const g of connector.inventory({
      credentials: { kind: "read", token: "t" },
      mcp: createFixtureMcpToolCaller(),
    })) {
      grants.push(g);
    }

    for (const fg of fixtureGrants) {
      const resourceId = (fg.resource as { id: string }).id;
      const capability = fg.capability as string;
      const principal = fg.principal as {
        identifiers: Array<{ kind: string; value: string }>;
      };
      const key =
        principal.identifiers.find((i) => i.kind === "key_id")?.value ??
        principal.identifiers.find((i) => i.kind === "username")?.value;
      expect(key).toBeTruthy();

      const match = grants.find(
        (g) =>
          g.resource.id === resourceId &&
          g.capability === capability &&
          g.principal.identifiers.some((i) => i.value === key),
      );
      expect(match, `missing fixture grant ${resourceId} / ${key}`).toBeDefined();
    }
  });
});
