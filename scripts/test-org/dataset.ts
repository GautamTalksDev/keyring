/**
 * Canonical Keyring test org — three fake people, deliberately messy grants.
 * Seed script writes fixtures from this module; live APIs are optional overlays.
 */

import {
  CI_TRAP_MARKER,
  createGrant,
  type CreateGrantInput,
  type Grant,
} from "../../packages/core/src/index.ts";

/** Fixed discovery time so fixture hashes stay stable across seed runs. */
export const DISCOVERED_AT = new Date("2026-08-24T17:00:00.000Z");

/** ~420 days before discovery — clearly stale. */
export const STALE_LAST_USED_AT = new Date("2025-06-30T12:00:00.000Z");

export interface TestPerson {
  key: "ada" | "grace" | "alan";
  displayName: string;
  workEmail: string;
  personalEmail: string;
  githubUsername: string;
  slackUserId: string;
  slackDisplayName: string;
}

/**
 * Throwaway identities for the messy org.
 * Work emails use the example.com reserved domain unless you override via env
 * (see docs/TEST_ORG.md) when seeding a real Workspace.
 */
export const TEST_PEOPLE: readonly TestPerson[] = [
  {
    key: "ada",
    displayName: "Ada Lovelace",
    workEmail: "ada@keyring-test.example",
    personalEmail: "ada.numbers.personal@keyring-test.example",
    githubUsername: "analyticalengine",
    slackUserId: "U_ADA_TEST",
    slackDisplayName: "ada.l",
  },
  {
    key: "grace",
    displayName: "Grace Hopper",
    workEmail: "grace@keyring-test.example",
    personalEmail: "grace.h.navy.mail@keyring-test.example",
    githubUsername: "cobol-compiler",
    slackUserId: "U_GRACE_TEST",
    slackDisplayName: "ghopper",
  },
  {
    key: "alan",
    displayName: "Alan Turing",
    workEmail: "alan@keyring-test.example",
    personalEmail: "enigmamachine88@keyring-test.example",
    githubUsername: "bombe-ops",
    slackUserId: "U_ALAN_TEST",
    slackDisplayName: "a.turing",
  },
] as const;

/** Re-export trap marker from core for seed/manifest consumers. */
export { CI_TRAP_MARKER } from "../../packages/core/src/index.ts";

export const CI_TRAP_RESOURCE = {
  id: "keyring-test/payments",
  displayName: "payments (prod deploy)",
  kind: "repo" as const,
};

export const CI_TRAP_KEY_ID = "AKIA_KEYRING_CI_ORPHAN_LOOKALIKE";

function workGrant(
  person: TestPerson,
  input: Omit<CreateGrantInput, "principal" | "discoveredAt" | "evidence"> & {
    evidenceClaim: string;
    evidenceSource: string;
  },
): CreateGrantInput {
  const { evidenceClaim, evidenceSource, ...rest } = input;
  return {
    ...rest,
    discoveredAt: DISCOVERED_AT,
    principal: {
      kind: "human",
      identifiers: [{ kind: "work_email", value: person.workEmail, source: evidenceSource }],
    },
    evidence: [
      {
        claim: evidenceClaim,
        source: evidenceSource,
        confidence: "certain",
      },
    ],
  };
}

/**
 * Full messy grant set. Order is stable for idempotent fixture writes.
 */
export function buildTestOrgGrantInputs(
  people: readonly TestPerson[] = TEST_PEOPLE,
): CreateGrantInput[] {
  const ada = people.find((p) => p.key === "ada")!;
  const grace = people.find((p) => p.key === "grace")!;
  const alan = people.find((p) => p.key === "alan")!;

  const grants: CreateGrantInput[] = [
    // --- Ada: clean work email ---
    workGrant(ada, {
      system: "google_workspace",
      resource: {
        id: "folders/ada-team-notes",
        displayName: "Ada / Team notes",
        kind: "drive_folder",
      },
      capability: "write",
      createdAt: new Date("2025-01-10T00:00:00.000Z"),
      lastUsedAt: new Date("2026-08-20T00:00:00.000Z"),
      revocable: {
        possible: true,
        reversible: true,
        method: "drive.permissions.delete",
      },
      evidenceClaim: `Drive ACL lists ${ada.workEmail} as writer on Ada / Team notes`,
      evidenceSource: "google_workspace",
    }),
    workGrant(ada, {
      system: "slack",
      resource: {
        id: "C_ENG_GENERAL",
        displayName: "#eng-general",
        kind: "channel",
      },
      capability: "write",
      lastUsedAt: new Date("2026-08-22T00:00:00.000Z"),
      revocable: { possible: true, reversible: true, method: "conversations.kick" },
      evidenceClaim: `Slack members.list includes ${ada.workEmail} in #eng-general`,
      evidenceSource: "slack",
    }),

    // --- Ada: messy personal Gmail on Drive ---
    {
      system: "google_workspace",
      principal: {
        kind: "human",
        identifiers: [
          {
            kind: "personal_email",
            value: ada.personalEmail,
            source: "google_workspace",
          },
        ],
      },
      resource: {
        id: "folders/board-compensation-2024",
        displayName: "Board compensation 2024",
        kind: "drive_folder",
      },
      capability: "read",
      createdAt: new Date("2024-11-02T00:00:00.000Z"),
      lastUsedAt: new Date("2025-03-01T00:00:00.000Z"),
      discoveredAt: DISCOVERED_AT,
      revocable: {
        possible: true,
        reversible: true,
        method: "drive.permissions.delete",
      },
      evidence: [
        {
          claim: `Drive folder shared to personal Gmail ${ada.personalEmail} (not work domain)`,
          source: "google_workspace",
          confidence: "certain",
        },
        {
          claim: `Personal address correlates to ${ada.displayName} via prior offboarding form`,
          source: "hr_notes",
          confidence: "probable",
        },
      ],
    },

    // --- Ada: GitHub username that does not match her name ---
    {
      system: "github",
      principal: {
        kind: "human",
        identifiers: [
          {
            kind: "username",
            value: ada.githubUsername,
            source: "github",
          },
        ],
      },
      resource: {
        id: "keyring-test/payments",
        displayName: "payments",
        kind: "repo",
      },
      capability: "write",
      createdAt: new Date("2024-08-01T00:00:00.000Z"),
      lastUsedAt: new Date("2026-07-15T00:00:00.000Z"),
      discoveredAt: DISCOVERED_AT,
      revocable: {
        possible: true,
        reversible: true,
        method: "remove_collaborator",
      },
      evidence: [
        {
          claim: `GitHub collaborator ${ada.githubUsername} has write on keyring-test/payments`,
          source: "github",
          confidence: "certain",
        },
        {
          claim: `Username ${ada.githubUsername} does not string-match ${ada.displayName}; linked via commit email ${ada.workEmail}`,
          source: "github_commit_email",
          confidence: "probable",
        },
      ],
    },

    // --- Grace: clean + stale (400+ days) ---
    workGrant(grace, {
      system: "google_workspace",
      resource: {
        id: "folders/grace-onboarding",
        displayName: "Grace / Onboarding",
        kind: "drive_folder",
      },
      capability: "owner",
      createdAt: new Date("2023-02-01T00:00:00.000Z"),
      lastUsedAt: new Date("2026-08-10T00:00:00.000Z"),
      revocable: {
        possible: true,
        reversible: false,
        method: "transfer_ownership_then_remove",
      },
      evidenceClaim: `Drive owner is ${grace.workEmail} on Grace / Onboarding`,
      evidenceSource: "google_workspace",
    }),
    workGrant(grace, {
      system: "notion",
      resource: {
        id: "page:legacy-runbook-2019",
        displayName: "Legacy pager runbook (2019)",
        kind: "page",
      },
      capability: "admin",
      createdAt: new Date("2019-04-12T00:00:00.000Z"),
      lastUsedAt: STALE_LAST_USED_AT,
      revocable: {
        possible: true,
        reversible: true,
        method: "notion.pages.update_permissions",
      },
      evidenceClaim: `Notion admin on Legacy pager runbook; last_edited_time ${STALE_LAST_USED_AT.toISOString()}`,
      evidenceSource: "notion",
    }),

    // --- Grace: personal Gmail Drive share ---
    {
      system: "google_workspace",
      principal: {
        kind: "human",
        identifiers: [
          {
            kind: "personal_email",
            value: grace.personalEmail,
            source: "google_workspace",
          },
        ],
      },
      resource: {
        id: "folders/customer-contracts-vault",
        displayName: "Customer contracts vault",
        kind: "drive_folder",
      },
      capability: "write",
      discoveredAt: DISCOVERED_AT,
      lastUsedAt: new Date("2025-12-01T00:00:00.000Z"),
      revocable: {
        possible: true,
        reversible: true,
        method: "drive.permissions.delete",
      },
      evidence: [
        {
          claim: `Customer contracts vault shared to personal Gmail ${grace.personalEmail}`,
          source: "google_workspace",
          confidence: "certain",
        },
      ],
    },

    // --- Grace: opaque GitHub username ---
    {
      system: "github",
      principal: {
        kind: "human",
        identifiers: [{ kind: "username", value: grace.githubUsername, source: "github" }],
      },
      resource: {
        id: "keyring-test/infra",
        displayName: "infra",
        kind: "repo",
      },
      capability: "admin",
      discoveredAt: DISCOVERED_AT,
      lastUsedAt: new Date("2026-05-01T00:00:00.000Z"),
      revocable: {
        possible: true,
        reversible: true,
        method: "remove_collaborator",
      },
      evidence: [
        {
          claim: `GitHub user ${grace.githubUsername} is admin on keyring-test/infra`,
          source: "github",
          confidence: "certain",
        },
      ],
    },

    // --- Alan: clean Slack + Google ---
    workGrant(alan, {
      system: "slack",
      resource: {
        id: "C_SECURITY",
        displayName: "#security",
        kind: "channel",
      },
      capability: "write",
      lastUsedAt: new Date("2026-08-21T00:00:00.000Z"),
      revocable: { possible: true, reversible: true, method: "conversations.kick" },
      evidenceClaim: `Slack #security membership for ${alan.workEmail}`,
      evidenceSource: "slack",
    }),
    workGrant(alan, {
      system: "google_workspace",
      resource: {
        id: "folders/alan-research",
        displayName: "Alan / Research",
        kind: "drive_folder",
      },
      capability: "write",
      lastUsedAt: new Date("2026-08-18T00:00:00.000Z"),
      revocable: {
        possible: true,
        reversible: true,
        method: "drive.permissions.delete",
      },
      evidenceClaim: `Drive writer ${alan.workEmail} on Alan / Research`,
      evidenceSource: "google_workspace",
    }),

    // --- Alan: personal Gmail ---
    {
      system: "google_workspace",
      principal: {
        kind: "human",
        identifiers: [
          {
            kind: "personal_email",
            value: alan.personalEmail,
            source: "google_workspace",
          },
        ],
      },
      resource: {
        id: "folders/incident-war-room-exports",
        displayName: "Incident war-room exports",
        kind: "drive_folder",
      },
      capability: "read",
      discoveredAt: DISCOVERED_AT,
      lastUsedAt: new Date("2026-01-05T00:00:00.000Z"),
      revocable: {
        possible: true,
        reversible: true,
        method: "drive.permissions.delete",
      },
      evidence: [
        {
          claim: `War-room exports shared to personal Gmail ${alan.personalEmail}`,
          source: "google_workspace",
          confidence: "certain",
        },
      ],
    },

    // --- Alan: GitHub username mismatch ---
    {
      system: "github",
      principal: {
        kind: "human",
        identifiers: [{ kind: "username", value: alan.githubUsername, source: "github" }],
      },
      resource: {
        id: "keyring-test/crypto-notes",
        displayName: "crypto-notes",
        kind: "repo",
      },
      capability: "write",
      discoveredAt: DISCOVERED_AT,
      lastUsedAt: new Date("2026-04-02T00:00:00.000Z"),
      revocable: {
        possible: true,
        reversible: true,
        method: "remove_collaborator",
      },
      evidence: [
        {
          claim: `GitHub collaborator ${alan.githubUsername} on crypto-notes (name does not match Alan Turing)`,
          source: "github",
          confidence: "certain",
        },
      ],
    },

    // --- High-capability, low-visibility (private Slack admin) ---
    {
      system: "slack",
      principal: {
        kind: "human",
        identifiers: [
          { kind: "work_email", value: ada.workEmail, source: "slack" },
          { kind: "username", value: ada.slackDisplayName, source: "slack" },
        ],
      },
      resource: {
        id: "G_PRIVATE_EXEC_COMP",
        displayName: "#exec-comp (private)",
        kind: "channel",
      },
      capability: "admin",
      createdAt: new Date("2025-09-01T00:00:00.000Z"),
      lastUsedAt: new Date("2026-02-14T00:00:00.000Z"),
      discoveredAt: DISCOVERED_AT,
      revocable: {
        possible: true,
        reversible: true,
        method: "admin.conversations.remove",
      },
      evidence: [
        {
          claim:
            "Private channel #exec-comp lists Ada as channel admin; channel is not in public workspace directory",
          source: "slack",
          confidence: "certain",
        },
      ],
    },

    // --- Unowned service account / API key ---
    {
      system: "aws",
      principal: {
        kind: "unknown",
        identifiers: [
          {
            kind: "key_id",
            value: "AKIA_KEYRING_UNLABELED_BATCH",
            source: "aws_iam",
          },
        ],
      },
      resource: {
        id: "arn:aws:iam::999999999999:role/BatchExports",
        displayName: "BatchExports",
        kind: "iam_role",
      },
      capability: "admin",
      discoveredAt: DISCOVERED_AT,
      revocable: {
        possible: true,
        reversible: false,
        method: "iam:DeleteAccessKey",
      },
      evidence: [
        {
          claim:
            "IAM access key AKIA_KEYRING_UNLABELED_BATCH has admin on BatchExports with empty Owner/Team tags",
          source: "aws_iam",
          confidence: "certain",
        },
        {
          claim: "No HR or IdP principal maps to this key id",
          source: "identity_reconciliation",
          confidence: "probable",
        },
      ],
    },

    // --- DELIBERATE TRAP: looks orphaned, actually CI — MUST NOT REVOKE ---
    {
      system: "github",
      principal: {
        kind: "unknown",
        identifiers: [
          {
            kind: "key_id",
            value: CI_TRAP_KEY_ID,
            source: "github_deploy_keys",
          },
        ],
      },
      resource: CI_TRAP_RESOURCE,
      capability: "admin",
      createdAt: new Date("2023-06-01T00:00:00.000Z"),
      // No lastUsedAt — looks abandoned
      discoveredAt: DISCOVERED_AT,
      revocable: {
        possible: true,
        reversible: false,
        method: "repos.delete_deploy_key",
      },
      evidence: [
        {
          claim: `Deploy key ${CI_TRAP_KEY_ID} has admin on ${CI_TRAP_RESOURCE.id} with title "" and no owner label — appears orphaned`,
          source: "github_deploy_keys",
          confidence: "certain",
        },
        {
          claim: `TRAP/${CI_TRAP_MARKER}: key is the GitHub Actions deploy key for prod payments CDN publish; revoking breaks release CI`,
          source: "runbook:ci-payments-deploy",
          confidence: "certain",
          raw: {
            mustSurviveDemo: true,
            proposedAction: "flag_only",
            demoDecision: "held",
          },
        },
      ],
    },
  ];

  return grants;
}

export function materializeTestOrgGrants(people: readonly TestPerson[] = TEST_PEOPLE): Grant[] {
  return buildTestOrgGrantInputs(people).map((input) => createGrant(input));
}

export function findCiTrapGrant(grants: readonly Grant[]): Grant {
  const trap = grants.find((g) => g.evidence.some((e) => e.claim.includes(CI_TRAP_MARKER)));
  if (!trap) {
    throw new Error("CI trap grant missing from test org dataset");
  }
  return trap;
}
