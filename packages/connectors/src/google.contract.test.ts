import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGoogleWorkspaceConnector } from "./google-workspace/connector.js";
import { createFixtureMcpToolCaller } from "./mcp/fixture-caller.js";
import type { InventoryContext } from "./types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DISCOVERED_AT = new Date("2026-08-24T17:00:00.000Z");

describe("GoogleWorkspaceConnector contract (MCP fixtures)", () => {
  it("yields outside-org Drive shares as personal_email grants", async () => {
    const connector = createGoogleWorkspaceConnector({
      orgDomain: "keyring-test.example",
      discoveredAt: DISCOVERED_AT,
    });
    const ctx: InventoryContext = {
      credentials: { kind: "read", token: "unused" },
      mcp: createFixtureMcpToolCaller(),
    };

    const grants = [];
    for await (const g of connector.inventory(ctx)) {
      grants.push(g);
    }

    expect(
      grants.every((g) =>
        g.evidence.every((e) => e.source.startsWith("mcp:google_workspace/")),
      ),
    ).toBe(true);

    const personal = grants.filter((g) =>
      g.principal.identifiers.some((i) => i.kind === "personal_email"),
    );
    expect(personal.length).toBeGreaterThanOrEqual(3);

    const adaPersonal = personal.find((g) =>
      g.principal.identifiers.some(
        (i) => i.value === "ada.numbers.personal@gmail.com",
      ),
    );
    expect(adaPersonal).toBeDefined();
    expect(adaPersonal!.resource.id).toContain("board-compensation-2024");
    expect(adaPersonal!.capability).toBe("read");
  });

  it("matches google_workspace grants from test-org fixtures", async () => {
    const raw = JSON.parse(
      await readFile(path.join(repoRoot, "fixtures/test-org/grants.json"), "utf8"),
    ) as { grants: Array<Record<string, unknown>> };
    const fixtureGrants = raw.grants.filter((g) => g.system === "google_workspace");

    const connector = createGoogleWorkspaceConnector({
      orgDomain: "keyring-test.example",
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
      const email = (
        fg.principal as { identifiers: Array<{ value: string }> }
      ).identifiers[0]?.value;
      expect(email).toBeTruthy();

      const match = grants.find(
        (g) =>
          g.resource.id === resourceId &&
          g.capability === capability &&
          g.principal.identifiers.some((i) => i.value === email),
      );
      expect(
        match,
        `missing google fixture grant ${resourceId} / ${email}`,
      ).toBeDefined();
    }
  });
});
