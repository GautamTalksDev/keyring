import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CreateGrantInput, Grant } from "../packages/core/src/index.ts";
import {
  CI_TRAP_KEY_ID,
  CI_TRAP_MARKER,
  CI_TRAP_RESOURCE,
  TEST_PEOPLE,
  buildTestOrgGrantInputs,
  findCiTrapGrant,
  materializeTestOrgGrants,
  type TestPerson,
} from "./test-org/dataset.ts";
import { seedLiveSystems } from "./test-org/live.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURES_DIR = path.join(repoRoot, "fixtures", "test-org");
const CONNECTORS_FIXTURES_DIR = path.join(
  repoRoot,
  "packages",
  "connectors",
  "fixtures",
);

function peopleFromEnv(base: readonly TestPerson[]): TestPerson[] {
  return base.map((person) => {
    const prefix = `KEYRING_TEST_${person.key.toUpperCase()}`;
    return {
      ...person,
      workEmail: process.env[`${prefix}_WORK_EMAIL`] ?? person.workEmail,
      personalEmail: process.env[`${prefix}_PERSONAL_EMAIL`] ?? person.personalEmail,
      githubUsername: process.env[`${prefix}_GITHUB_USERNAME`] ?? person.githubUsername,
      slackUserId: process.env[`${prefix}_SLACK_USER_ID`] ?? person.slackUserId,
      slackDisplayName:
        process.env[`${prefix}_SLACK_DISPLAY_NAME`] ?? person.slackDisplayName,
    };
  });
}

function serializeGrantInput(input: CreateGrantInput): Record<string, unknown> {
  return {
    system: input.system,
    principal: input.principal,
    resource: input.resource,
    capability: input.capability,
    ...(input.createdAt ? { createdAt: input.createdAt.toISOString() } : {}),
    ...(input.lastUsedAt ? { lastUsedAt: input.lastUsedAt.toISOString() } : {}),
    discoveredAt: input.discoveredAt.toISOString(),
    revocable: input.revocable,
    evidence: input.evidence,
  };
}

function serializeGrant(grant: Grant): Record<string, unknown> {
  return {
    id: grant.id,
    system: grant.system,
    principal: grant.principal,
    resource: grant.resource,
    capability: grant.capability,
    ...(grant.createdAt ? { createdAt: grant.createdAt.toISOString() } : {}),
    ...(grant.lastUsedAt ? { lastUsedAt: grant.lastUsedAt.toISOString() } : {}),
    discoveredAt: grant.discoveredAt.toISOString(),
    revocable: grant.revocable,
    evidence: grant.evidence,
  };
}

export async function writeFixtures(people: readonly TestPerson[]): Promise<{
  inputs: CreateGrantInput[];
  grants: Grant[];
  trap: Grant;
}> {
  const inputs = buildTestOrgGrantInputs(people);
  const grants = materializeTestOrgGrants(people);
  const trap = findCiTrapGrant(grants);

  await mkdir(FIXTURES_DIR, { recursive: true });
  await mkdir(CONNECTORS_FIXTURES_DIR, { recursive: true });

  const peopleDoc = {
    org: process.env.KEYRING_TEST_ORG_NAME ?? "keyring-test",
    people,
  };

  const grantsDoc = { grants: inputs.map(serializeGrantInput) };
  const materializedDoc = { grants: grants.map(serializeGrant) };

  const manifest = {
    org: peopleDoc.org,
    generatedAt: new Date().toISOString(),
    grantCount: grants.length,
    peopleCount: people.length,
    surviveDemo: {
      label:
        "CI deploy key on payments — looks orphaned (unknown principal, empty title, no lastUsedAt) but is GitHub Actions prod publish. Demo action: HOLD / flag_only. Never revoke.",
      marker: CI_TRAP_MARKER,
      grantId: trap.id,
      system: trap.system,
      resourceId: CI_TRAP_RESOURCE.id,
      principalKeyId: CI_TRAP_KEY_ID,
      proposedAction: "flag_only",
      demoStatus: "held",
    },
  };

  await writeFile(
    path.join(FIXTURES_DIR, "people.json"),
    `${JSON.stringify(peopleDoc, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(FIXTURES_DIR, "grants.json"),
    `${JSON.stringify(grantsDoc, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(FIXTURES_DIR, "grants.materialized.json"),
    `${JSON.stringify(materializedDoc, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(FIXTURES_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  // Mirror for FixtureConnector default package path (exact same grants.json).
  await writeFile(
    path.join(CONNECTORS_FIXTURES_DIR, "test-org-grants.json"),
    `${JSON.stringify(grantsDoc, null, 2)}\n`,
    "utf8",
  );

  return { inputs, grants, trap };
}

async function main(): Promise<void> {
  const people = peopleFromEnv(TEST_PEOPLE);
  const { grants, trap } = await writeFixtures(people);

  console.log(`Wrote ${grants.length} grants → ${FIXTURES_DIR}`);
  console.log(`Survive-demo grant id: ${trap.id}`);
  console.log(`  resource: ${trap.resource.id}`);
  console.log(`  principal: ${JSON.stringify(trap.principal.identifiers)}`);

  const live = process.env.SEED_LIVE === "true" || process.env.SEED_LIVE === "1";
  if (!live) {
    console.log("Skipping live API seed (set SEED_LIVE=true and credentials to apply).");
    return;
  }

  const result = await seedLiveSystems(people);
  for (const line of result.lines) {
    console.log(line);
  }
}

await main();
