import { describe, expect, expectTypeOf, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFixtureConnector } from "./fixture.js";
import type {
  Connector,
  InventoryContext,
  ReadCredentials,
  RevokeContext,
  WriteCredentials,
} from "./types.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("Connector context separation", () => {
  it("types inventory to accept only InventoryContext / ReadCredentials", () => {
    expectTypeOf<InventoryContext["credentials"]>().toEqualTypeOf<ReadCredentials>();
    expectTypeOf<RevokeContext["credentials"]>().toEqualTypeOf<WriteCredentials>();
    expectTypeOf<ReadCredentials["kind"]>().toEqualTypeOf<"read">();
    expectTypeOf<WriteCredentials["kind"]>().toEqualTypeOf<"write">();

    type InventoryParam = Parameters<Connector["inventory"]>[0];
    type RevokeCtxParam = Parameters<Connector["revoke"]>[1];
    expectTypeOf<InventoryParam>().toEqualTypeOf<InventoryContext>();
    expectTypeOf<RevokeCtxParam>().toEqualTypeOf<RevokeContext>();

    expectTypeOf<InventoryParam["credentials"]>().not.toEqualTypeOf<WriteCredentials>();
  });
});

describe("FixtureConnector", () => {
  it("yields the messy test-org grants from fixtures", async () => {
    const connector = createFixtureConnector();
    const ctx: InventoryContext = {
      credentials: { kind: "read", token: "fixture-read" },
    };

    const grants = [];
    for await (const grant of connector.inventory(ctx)) {
      grants.push(grant);
    }

    expect(grants.length).toBeGreaterThanOrEqual(14);
    expect(grants.every((g) => g.evidence.length > 0)).toBe(true);

    const systems = new Set(grants.map((g) => g.system));
    expect(systems.has("github")).toBe(true);
    expect(systems.has("google_workspace")).toBe(true);
    expect(systems.has("slack")).toBe(true);
    expect(systems.has("aws")).toBe(true);
  });

  it("includes the CI trap grant that must survive the demo", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(repoRoot, "fixtures/test-org/manifest.json"), "utf8"),
    ) as {
      surviveDemo: { grantId: string; marker: string; demoStatus: string };
    };

    const connector = createFixtureConnector({
      fixturesDir: path.join(repoRoot, "fixtures/test-org"),
    });
    const grants = [];
    for await (const grant of connector.inventory({
      credentials: { kind: "read", token: "r" },
    })) {
      grants.push(grant);
    }

    const trap = grants.find((g) => g.id === manifest.surviveDemo.grantId);
    expect(trap).toBeDefined();
    expect(
      trap!.evidence.some((e) => e.claim.includes(manifest.surviveDemo.marker)),
    ).toBe(true);
    expect(manifest.surviveDemo.demoStatus).toBe("held");
    expect(trap!.principal.kind).toBe("unknown");
    expect(trap!.lastUsedAt).toBeUndefined();
  });

  it("declares capabilities for the UI", () => {
    const caps = createFixtureConnector().capabilities();
    expect(caps.canRevoke).toBe(true);
    expect(caps.canDowngrade).toBe(false);
    expect(caps.reportsLastUsed).toBe(true);
  });

  it("revoke requires write context and does not run during inventory", async () => {
    const connector = createFixtureConnector();
    const readCtx: InventoryContext = {
      credentials: { kind: "read", token: "r" },
    };

    let count = 0;
    for await (const _ of connector.inventory(readCtx)) {
      count += 1;
    }
    expect(count).toBeGreaterThan(0);

    const grant = (
      await (async () => {
        for await (const g of connector.inventory(readCtx)) return g;
        throw new Error("no grants");
      })()
    )!;

    const result = await connector.revoke(grant, {
      credentials: { kind: "write", token: "w" },
      approvedBy: "judge@acme.com",
      approvalCardId: "card-1",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects inventory when credentials are not read-scoped at runtime", async () => {
    const connector = createFixtureConnector();
    const bad = {
      credentials: { kind: "write", token: "nope" },
    } as unknown as InventoryContext;

    await expect(async () => {
      for await (const _ of connector.inventory(bad)) {
        // should throw before yielding
      }
    }).rejects.toThrow(/ReadCredentials/);
  });
});
