import { describe, expect, it } from "vitest";

import { createGitHubConnector } from "./github/connector.js";
import { createGoogleWorkspaceConnector } from "./google-workspace/connector.js";
import { createTrueForgeMcpToolCaller } from "./mcp/trueforge-caller.js";
import type { InventoryContext } from "./types.js";

const live = process.env.LIVE_CONNECTORS === "1" || process.env.LIVE_CONNECTORS === "true";

/**
 * Opt-in live suite. Skipped in CI by default.
 *
 * Requires TrueForge-configured MCP servers + env:
 *   LIVE_CONNECTORS=1
 *   TRUEFORGE_BASE_URL=http://localhost:8791
 *   GITHUB_MCP_URL=https://api.githubcopilot.com/mcp/
 *   GITHUB_TOKEN=...
 *   GITHUB_ORG=keyring-test
 *   GOOGLE_WORKSPACE_MCP_URL=...
 *   GOOGLE_ACCESS_TOKEN=...
 *   GOOGLE_ORG_DOMAIN=keyring-test.example
 */
describe.skipIf(!live)("live connectors against test org", () => {
  it("GitHub inventory returns collaborator grants for the test org", async () => {
    const org = process.env.GITHUB_ORG ?? "keyring-test";
    const token = process.env.GITHUB_TOKEN ?? process.env.KEYRING_GITHUB_TOKEN;
    const mcpUrl =
      process.env.GITHUB_MCP_URL ?? "https://api.githubcopilot.com/mcp/";
    expect(token, "GITHUB_TOKEN required for live test").toBeTruthy();

    const mcp = createTrueForgeMcpToolCaller({
      trueforgeBaseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8791",
      servers: {
        github: {
          url: mcpUrl,
          headers: {
            Authorization: `Bearer ${token}`,
            "X-MCP-Readonly": "true",
          },
        },
      },
    });

    const connector = createGitHubConnector({ org });
    const ctx: InventoryContext = {
      credentials: { kind: "read", token: token! },
      mcp,
    };

    const grants = [];
    for await (const g of connector.inventory(ctx)) {
      grants.push(g);
    }
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.some((g) => g.system === "github")).toBe(true);
  }, 120_000);

  it("Google Workspace inventory includes a personal-Gmail Drive share", async () => {
    const domain = process.env.GOOGLE_ORG_DOMAIN ?? "keyring-test.example";
    const token =
      process.env.GOOGLE_ACCESS_TOKEN ?? process.env.KEYRING_GOOGLE_ACCESS_TOKEN;
    const mcpUrl = process.env.GOOGLE_WORKSPACE_MCP_URL;
    expect(token, "GOOGLE_ACCESS_TOKEN required").toBeTruthy();
    expect(mcpUrl, "GOOGLE_WORKSPACE_MCP_URL required").toBeTruthy();

    const mcp = createTrueForgeMcpToolCaller({
      trueforgeBaseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8791",
      servers: {
        google_workspace: {
          url: mcpUrl!,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    });

    const connector = createGoogleWorkspaceConnector({ orgDomain: domain });
    const grants = [];
    for await (const g of connector.inventory({
      credentials: { kind: "read", token: token! },
      mcp,
    })) {
      grants.push(g);
    }

    const personal = grants.filter((g) =>
      g.principal.identifiers.some((i) => i.kind === "personal_email"),
    );
    expect(personal.length).toBeGreaterThan(0);
  }, 120_000);
});
