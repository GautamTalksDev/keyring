import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createGrant } from "../grant.js";
import { runReconciliationFromJson } from "./run.js";
import { usernameNameSimilarity } from "./similarity.js";
import { reconcileIdentities } from "./reconcile.js";
import type { DirectoryEntry } from "./types.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

async function loadFixtureInput() {
  const grantsDoc = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/test-org/grants.json"), "utf8"),
  ) as { grants: unknown[] };
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

  const directory: DirectoryEntry[] = peopleDoc.people.map((p) => ({
    displayName: p.displayName,
    workEmails: [p.workEmail],
    personalEmails: [p.personalEmail],
    usernames: [p.githubUsername],
  }));

  return { grants: grantsDoc.grants, directory };
}

describe("usernameNameSimilarity", () => {
  it("matches schen-dev to Sarah Chen (probable-tier score)", () => {
    expect(usernameNameSimilarity("schen-dev", "Sarah Chen")).toBeGreaterThanOrEqual(
      0.72,
    );
  });

  it("does not match opaque handles to unrelated names", () => {
    expect(usernameNameSimilarity("analyticalengine", "Ada Lovelace")).toBeLessThan(
      0.72,
    );
    expect(usernameNameSimilarity("cobol-compiler", "Grace Hopper")).toBeLessThan(0.72);
  });
});

describe("reconcileIdentities — fixture test org", () => {
  it("clusters the three fake people and leaves unattributable grants unknown", async () => {
    const input = await loadFixtureInput();
    const result = runReconciliationFromJson(input);

    const names = result.clusters.map((c) => c.displayName).sort();
    expect(names).toEqual(["Ada Lovelace", "Alan Turing", "Grace Hopper"]);

    for (const cluster of result.clusters) {
      expect(cluster.kind).toBe("human");
      expect(cluster.grantIds.length).toBeGreaterThan(0);
      expect(cluster.reasoning.length).toBeGreaterThan(20);
      expect(cluster.confidence).toMatch(/certain|probable|speculative/);
    }

    // Ada should pick up work email + personal Gmail + github username via directory
    const ada = result.clusters.find((c) => c.displayName === "Ada Lovelace")!;
    expect(
      ada.identifiers.some(
        (i) => i.kind === "work_email" && i.value === "ada@keyring-test.example",
      ),
    ).toBe(true);
    expect(
      ada.identifiers.some(
        (i) =>
          i.kind === "personal_email" &&
          i.value === "ada.numbers.personal@gmail.com",
      ),
    ).toBe(true);
    expect(
      ada.identifiers.some(
        (i) => i.kind === "username" && i.value === "analyticalengine",
      ),
    ).toBe(true);

    // Genuinely unattributable: AWS unlabeled key + CI trap deploy key (and any other orphans)
    expect(result.unknown.grantIds.length).toBeGreaterThanOrEqual(2);
    expect(result.unknown.reasoning).toMatch(/unknown/i);

    const attributed = new Set(result.clusters.flatMap((c) => c.grantIds));
    for (const gid of result.unknown.grantIds) {
      expect(attributed.has(gid)).toBe(false);
    }

    // Every grant is either clustered or unknown — no silent drops
    const total =
      result.clusters.reduce((n, c) => n + c.grantIds.length, 0) +
      result.unknown.grantIds.length;
    expect(total).toBe(input.grants.length);
  });
});

describe("reconcileIdentities — adversarial table", () => {
  const cases: Array<{
    name: string;
    run: () => void;
  }> = [
    {
      name: "two employees with the same first name are not merged by username similarity",
      run: () => {
        const directory: DirectoryEntry[] = [
          {
            displayName: "Sarah Chen",
            workEmails: ["sarah.chen@acme.test"],
            usernames: [],
          },
          {
            displayName: "Sarah Connor",
            workEmails: ["sarah.connor@acme.test"],
            usernames: [],
          },
        ];
        const grants = [
          createGrant({
            system: "github",
            principal: {
              kind: "human",
              identifiers: [
                // Matches BOTH Sarahs on first name → ambiguous → must stay unknown
                { kind: "username", value: "sarah", source: "github" },
              ],
            },
            resource: { id: "acme/app", displayName: "app", kind: "repo" },
            capability: "write",
            discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
            revocable: {
              possible: true,
              reversible: true,
              method: "remove_collaborator",
            },
            evidence: [
              {
                claim: "collab",
                source: "test",
                confidence: "certain",
              },
            ],
          }),
          createGrant({
            system: "slack",
            principal: {
              kind: "human",
              identifiers: [
                {
                  kind: "work_email",
                  value: "sarah.chen@acme.test",
                  source: "slack",
                },
              ],
            },
            resource: { id: "C1", displayName: "#eng", kind: "channel" },
            capability: "write",
            discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
            revocable: {
              possible: true,
              reversible: true,
              method: "kick",
            },
            evidence: [
              { claim: "member", source: "test", confidence: "certain" },
            ],
          }),
          createGrant({
            system: "slack",
            principal: {
              kind: "human",
              identifiers: [
                {
                  kind: "work_email",
                  value: "sarah.connor@acme.test",
                  source: "slack",
                },
              ],
            },
            resource: { id: "C2", displayName: "#ops", kind: "channel" },
            capability: "write",
            discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
            revocable: {
              possible: true,
              reversible: true,
              method: "kick",
            },
            evidence: [
              { claim: "member", source: "test", confidence: "certain" },
            ],
          }),
        ];

        // "sarah" resembles BOTH Sarah Chen and Sarah Connor → ambiguous → stay unknown
        const result = reconcileIdentities({ grants, directory });
        const chen = result.clusters.find((c) => c.displayName === "Sarah Chen")!;
        const connor = result.clusters.find((c) => c.displayName === "Sarah Connor")!;
        expect(chen.grantIds).toHaveLength(1);
        expect(connor.grantIds).toHaveLength(1);
        expect(
          result.unknown.grantIds.includes(
            grants.find((g) =>
              g.principal.identifiers.some((i) => i.value === "sarah"),
            )!.id,
          ),
        ).toBe(true);
      },
    },
    {
      name: "contractor with three emails clusters into one person",
      run: () => {
        const directory: DirectoryEntry[] = [
          {
            displayName: "Jordan Lee",
            workEmails: ["jordan.lee@acme.test"],
            personalEmails: ["jordan.personal@gmail.com", "jlee.contract@proton.me"],
          },
        ];
        const grants = [
          createGrant({
            system: "google_workspace",
            principal: {
              kind: "human",
              identifiers: [
                {
                  kind: "work_email",
                  value: "jordan.lee@acme.test",
                  source: "google_workspace",
                },
              ],
            },
            resource: {
              id: "folders/jordan",
              displayName: "Jordan",
              kind: "drive_folder",
            },
            capability: "write",
            discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
            revocable: {
              possible: true,
              reversible: true,
              method: "drive.permissions.delete",
            },
            evidence: [
              { claim: "acl", source: "test", confidence: "certain" },
            ],
          }),
          createGrant({
            system: "google_workspace",
            principal: {
              kind: "human",
              identifiers: [
                {
                  kind: "personal_email",
                  value: "jordan.personal@gmail.com",
                  source: "google_workspace",
                },
              ],
            },
            resource: {
              id: "folders/shared",
              displayName: "Shared",
              kind: "drive_folder",
            },
            capability: "read",
            discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
            revocable: {
              possible: true,
              reversible: true,
              method: "drive.permissions.delete",
            },
            evidence: [
              { claim: "external share", source: "test", confidence: "certain" },
            ],
          }),
          createGrant({
            system: "google_workspace",
            principal: {
              kind: "human",
              identifiers: [
                {
                  kind: "personal_email",
                  value: "jlee.contract@proton.me",
                  source: "google_workspace",
                },
              ],
            },
            resource: {
              id: "folders/vendor",
              displayName: "Vendor",
              kind: "drive_folder",
            },
            capability: "read",
            discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
            revocable: {
              possible: true,
              reversible: true,
              method: "drive.permissions.delete",
            },
            evidence: [
              { claim: "external share", source: "test", confidence: "certain" },
            ],
          }),
          createGrant({
            system: "github",
            principal: {
              kind: "human",
              identifiers: [
                {
                  kind: "commit_email",
                  value: "jordan.lee@acme.test",
                  source: "github",
                },
                {
                  kind: "username",
                  value: "jlee-codes",
                  source: "github",
                },
              ],
            },
            resource: { id: "acme/job", displayName: "job", kind: "repo" },
            capability: "write",
            discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
            revocable: {
              possible: true,
              reversible: true,
              method: "remove_collaborator",
            },
            evidence: [
              { claim: "collab", source: "test", confidence: "certain" },
            ],
          }),
        ];

        const result = reconcileIdentities({ grants, directory });
        expect(result.clusters).toHaveLength(1);
        expect(result.clusters[0]!.displayName).toBe("Jordan Lee");
        expect(result.clusters[0]!.grantIds).toHaveLength(4);
        expect(result.unknown.grantIds).toHaveLength(0);
        expect(result.clusters[0]!.reasoning).toMatch(/work-email|personal email|commit email/i);
      },
    },
    {
      name: "shared service account stays unknown without attribution",
      run: () => {
        const directory: DirectoryEntry[] = [
          {
            displayName: "Ada Lovelace",
            workEmails: ["ada@acme.test"],
          },
        ];
        const grants = [
          createGrant({
            system: "aws",
            principal: {
              kind: "service_account",
              identifiers: [
                {
                  kind: "key_id",
                  value: "AKIA_SHARED_CI",
                  source: "aws",
                },
              ],
            },
            resource: {
              id: "arn:aws:iam::1:role/CI",
              displayName: "CI",
              kind: "iam_role",
            },
            capability: "admin",
            discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
            revocable: {
              possible: true,
              reversible: false,
              method: "iam:DeleteAccessKey",
            },
            evidence: [
              {
                claim: "shared CI key, no owner tag",
                source: "test",
                confidence: "certain",
              },
            ],
          }),
          createGrant({
            system: "google_workspace",
            principal: {
              kind: "human",
              identifiers: [
                {
                  kind: "work_email",
                  value: "ada@acme.test",
                  source: "google_workspace",
                },
              ],
            },
            resource: {
              id: "folders/ada",
              displayName: "Ada",
              kind: "drive_folder",
            },
            capability: "write",
            discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
            revocable: {
              possible: true,
              reversible: true,
              method: "drive.permissions.delete",
            },
            evidence: [
              { claim: "acl", source: "test", confidence: "certain" },
            ],
          }),
        ];

        const result = reconcileIdentities({ grants, directory });
        expect(result.clusters).toHaveLength(1);
        expect(result.clusters[0]!.displayName).toBe("Ada Lovelace");
        expect(result.unknown.grantIds).toHaveLength(1);
        expect(result.unknown.grantIds[0]).toBe(grants[0]!.id);
      },
    },
    {
      name: "key attribution attaches a token to a resolved principal (probable)",
      run: () => {
        const directory: DirectoryEntry[] = [
          {
            displayName: "Ada Lovelace",
            workEmails: ["ada@acme.test"],
          },
        ];
        const grants = [
          createGrant({
            system: "google_workspace",
            principal: {
              kind: "human",
              identifiers: [
                {
                  kind: "work_email",
                  value: "ada@acme.test",
                  source: "google_workspace",
                },
              ],
            },
            resource: {
              id: "folders/ada",
              displayName: "Ada",
              kind: "drive_folder",
            },
            capability: "write",
            discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
            revocable: {
              possible: true,
              reversible: true,
              method: "drive.permissions.delete",
            },
            evidence: [
              { claim: "acl", source: "test", confidence: "certain" },
            ],
          }),
          createGrant({
            system: "aws",
            principal: {
              kind: "unknown",
              identifiers: [
                { kind: "key_id", value: "AKIA_ADA_LAPTOP", source: "aws" },
              ],
            },
            resource: {
              id: "arn:aws:iam::1:user/ada",
              displayName: "ada",
              kind: "iam_role",
            },
            capability: "admin",
            discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
            revocable: {
              possible: true,
              reversible: false,
              method: "iam:DeleteAccessKey",
            },
            evidence: [
              { claim: "key", source: "test", confidence: "certain" },
            ],
          }),
        ];

        const result = reconcileIdentities({
          grants,
          directory,
          keyAttributions: [
            {
              keyId: "AKIA_ADA_LAPTOP",
              attributedTo: "ada@acme.test",
              source: "cloudtrail:CreateAccessKey",
            },
          ],
        });
        expect(result.clusters).toHaveLength(1);
        expect(result.clusters[0]!.grantIds).toHaveLength(2);
        expect(result.clusters[0]!.confidence).toBe("probable");
        expect(result.clusters[0]!.reasoning).toMatch(/key\/token creation attributed/i);
        expect(result.unknown.grantIds).toHaveLength(0);
      },
    },
  ];

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_title, c) => {
    c.run();
  });
});
