import { describe, expect, it } from "vitest";

import { createGrant } from "@keyring/core";

import { createGitHubConnector } from "./github/connector.js";
import { createGoogleWorkspaceConnector } from "./google-workspace/connector.js";
import { createFixtureMcpToolCaller } from "./mcp/fixture-caller.js";
import { McpToolError } from "./mcp/types.js";
import type { McpToolCaller, RevokeContext } from "./types.js";

const DISCOVERED = new Date("2026-08-24T17:00:00.000Z");

function writeCtx(overrides: Partial<RevokeContext> = {}): RevokeContext {
  return {
    credentials: { kind: "write", token: "write" },
    approvedBy: "auditor@keyring.test",
    approvalCardId: "card-1",
    mcp: createFixtureMcpToolCaller(),
    ...overrides,
  };
}

describe("GitHub revoke", () => {
  const connector = createGitHubConnector({
    org: "keyring-test",
    discoveredAt: DISCOVERED,
  });

  it("dry-runs collaborator revoke with undo hint and zero mutating calls", async () => {
    let calls = 0;
    const mcp: McpToolCaller = {
      async callTool(req) {
        calls += 1;
        return createFixtureMcpToolCaller().callTool(req);
      },
    };
    const grant = createGrant({
      system: "github",
      principal: {
        kind: "human",
        identifiers: [{ kind: "username", value: "analyticalengine", source: "github" }],
      },
      resource: {
        id: "keyring-test/payments",
        displayName: "payments",
        kind: "repo",
      },
      capability: "write",
      discoveredAt: DISCOVERED,
      revocable: {
        possible: true,
        reversible: true,
        method: "remove_collaborator",
      },
      evidence: [
        {
          claim: "collab",
          source: "mcp:github/list_repository_collaborators",
          confidence: "certain",
        },
      ],
    });

    const result = await connector.revoke(grant, writeCtx({ dryRun: true, mcp }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toMatch(/dry_run/);
      expect(result.undoHint?.permission).toBe("push");
      expect(result.undoHint?.restoreMethod).toBe("add_repository_collaborator");
    }
    expect(calls).toBe(0);
  });

  it("revokes collaborator via MCP and treats already-absent as success", async () => {
    const grant = createGrant({
      system: "github",
      principal: {
        kind: "human",
        identifiers: [{ kind: "username", value: "analyticalengine", source: "github" }],
      },
      resource: {
        id: "keyring-test/payments",
        displayName: "payments",
        kind: "repo",
      },
      capability: "admin",
      discoveredAt: DISCOVERED,
      revocable: {
        possible: true,
        reversible: true,
        method: "remove_collaborator",
      },
      evidence: [
        {
          claim: "collab",
          source: "mcp:github/list_repository_collaborators",
          confidence: "certain",
        },
      ],
    });

    const ok = await connector.revoke(grant, writeCtx());
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.undoHint?.permission).toBe("admin");

    const absentMcp: McpToolCaller = {
      async callTool() {
        throw new McpToolError("Not Found — is not a collaborator", {
          server: "github",
          tool: "remove_repository_collaborator",
          status: 404,
        });
      },
    };
    const absent = await connector.revoke(grant, writeCtx({ mcp: absentMcp }));
    expect(absent.ok).toBe(true);
    if (absent.ok) expect(absent.alreadyAbsent).toBe(true);
  });

  it("revokes team membership with undo hint", async () => {
    const grant = createGrant({
      system: "github",
      principal: {
        kind: "human",
        identifiers: [{ kind: "username", value: "analyticalengine", source: "github" }],
      },
      resource: {
        id: "keyring-test/team:eng",
        displayName: "eng",
        kind: "other",
      },
      capability: "read",
      discoveredAt: DISCOVERED,
      revocable: {
        possible: true,
        reversible: true,
        method: "teams.remove_membership",
      },
      evidence: [
        {
          claim: "team",
          source: "mcp:github/get_team_members",
          confidence: "certain",
        },
      ],
    });
    const result = await connector.revoke(grant, writeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.undoHint?.restoreMethod).toBe("add_team_member");
      expect(result.undoHint?.params).toMatchObject({
        org: "keyring-test",
        team_slug: "eng",
        username: "analyticalengine",
      });
    }
  });
});

describe("Google Workspace revoke", () => {
  const connector = createGoogleWorkspaceConnector({
    orgDomain: "keyring-test.example",
    discoveredAt: DISCOVERED,
  });

  it("revokes Drive permission with restorable undo hint", async () => {
    const grant = createGrant({
      system: "google_workspace",
      principal: {
        kind: "human",
        identifiers: [
          {
            kind: "personal_email",
            value: "ada.personal@gmail.com",
            source: "google_workspace",
          },
        ],
      },
      resource: {
        id: "folders/folder-ada-notes",
        displayName: "Ada notes",
        kind: "drive_folder",
      },
      capability: "write",
      discoveredAt: DISCOVERED,
      revocable: {
        possible: true,
        reversible: true,
        method: "drive.permissions.delete",
      },
      evidence: [
        {
          claim: "share",
          source: "mcp:google_workspace/list_drive_shares_outside_org",
          confidence: "certain",
          raw: { perm: { id: "perm-1", role: "writer" } },
        },
      ],
    });
    const result = await connector.revoke(grant, writeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.undoHint?.permission).toBe("writer");
      expect(result.undoHint?.restoreMethod).toBe("drive.permissions.create");
      expect(result.undoHint?.params).toMatchObject({
        fileId: "folder-ada-notes",
        email: "ada.personal@gmail.com",
        previousPermissionId: "perm-1",
      });
    }
  });

  it("revokes group membership", async () => {
    const grant = createGrant({
      system: "google_workspace",
      principal: {
        kind: "human",
        identifiers: [
          {
            kind: "work_email",
            value: "ada@keyring-test.example",
            source: "google_workspace",
          },
        ],
      },
      resource: {
        id: "groups/eng@keyring-test.example",
        displayName: "eng",
        kind: "other",
      },
      capability: "read",
      discoveredAt: DISCOVERED,
      revocable: {
        possible: true,
        reversible: true,
        method: "directory.members.delete",
      },
      evidence: [
        {
          claim: "member",
          source: "mcp:google_workspace/list_group_members",
          confidence: "certain",
        },
      ],
    });
    const result = await connector.revoke(grant, writeCtx({ dryRun: true }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toMatch(/dry_run/);
      expect(result.undoHint?.permission).toBe("MEMBER");
    }
  });
});
