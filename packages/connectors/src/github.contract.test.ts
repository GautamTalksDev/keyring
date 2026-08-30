import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGitHubConnector } from "./github/connector.js";
import { createFixtureMcpToolCaller } from "./mcp/fixture-caller.js";
import { McpToolError, type McpToolCaller } from "./mcp/types.js";
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
  async function inventory(mcp: McpToolCaller = createFixtureMcpToolCaller()) {
    const connector = createGitHubConnector({
      org: "keyring-test",
      discoveredAt: DISCOVERED_AT,
    });
    const grants = [];
    for await (const grant of connector.inventory({
      credentials: { kind: "read", token: "t" },
      mcp,
    })) {
      grants.push(grant);
    }
    return grants;
  }

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
    expect(grants.every((g) => g.evidence.every((e) => e.source.startsWith("mcp:github/")))).toBe(
      true,
    );

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

  it("maps pending invitation pull, push, and admin permissions correctly", async () => {
    const invitations = (await inventory()).filter(
      (grant) => grant.accessState === "pending_invitation",
    );

    expect(
      invitations.map((grant) => [grant.principal.identifiers[0]?.value, grant.capability]),
    ).toEqual(
      expect.arrayContaining([
        ["pull-invite", "read"],
        ["push-invite", "write"],
        ["admin-invite", "admin"],
      ]),
    );
  });

  it("swallows only an unavailable invitation tool", async () => {
    const delegate = createFixtureMcpToolCaller();
    const mcp: McpToolCaller = {
      async callTool(request) {
        if (request.tool === "list_repository_invitations") {
          throw new McpToolError("tool list_repository_invitations not found", {
            server: request.server,
            tool: request.tool,
            status: 404,
          });
        }
        return delegate.callTool(request);
      },
    };

    await expect(inventory(mcp)).resolves.toEqual(expect.any(Array));
  });

  it("surfaces invitation authentication failures for a partial scan", async () => {
    const delegate = createFixtureMcpToolCaller();
    const mcp: McpToolCaller = {
      async callTool(request) {
        if (request.tool === "list_repository_invitations") {
          throw new McpToolError("GitHub token is not authorized", {
            server: request.server,
            tool: request.tool,
            status: 401,
          });
        }
        return delegate.callTool(request);
      },
    };

    await expect(inventory(mcp)).rejects.toMatchObject({
      name: "McpToolError",
      status: 401,
    });
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

  it("represents pending invitations separately from active collaborators", async () => {
    const fixture = createFixtureMcpToolCaller();
    const connector = createGitHubConnector({
      org: "keyring-test",
      discoveredAt: DISCOVERED_AT,
    });
    const grants = [];
    const invitationCalls: string[] = [];
    for await (const grant of connector.inventory({
      credentials: { kind: "read", token: "t" },
      mcp: {
        async callTool(request) {
          if (request.tool === "list_repository_invitations") {
            invitationCalls.push(String(request.arguments?.repo));
            return {
              server: request.server,
              tool: request.tool,
              data:
                request.arguments?.repo === "payments"
                  ? [
                      {
                        id: 42,
                        invitee: { login: "pending-user" },
                        permissions: { push: true },
                      },
                    ]
                  : [],
            };
          }
          return fixture.callTool(request);
        },
      },
    })) {
      grants.push(grant);
    }

    expect(invitationCalls).toContain("payments");
    const invitation = grants.find((grant) => grant.accessState === "pending_invitation");
    expect(invitation).toMatchObject({
      accessState: "pending_invitation",
      resource: {
        id: "keyring-test/payments/invitation:42",
      },
      revocable: {
        method: "delete_repository_invitation",
      },
    });
  });
});
