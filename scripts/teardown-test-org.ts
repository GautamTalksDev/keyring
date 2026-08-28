import { TEST_PEOPLE, type TestPerson } from "./test-org/dataset.ts";
import { teardownLiveSystems } from "./test-org/live.ts";

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

async function main(): Promise<void> {
  const live = process.env.SEED_LIVE === "true" || process.env.SEED_LIVE === "1";
  if (!live) {
    console.log(
      "Refusing teardown without SEED_LIVE=true (prevents accidental no-op confusion).",
    );
    console.log("Fixtures are not deleted by teardown. See docs/TEST_ORG.md.");
    process.exitCode = 1;
    return;
  }

  const people = peopleFromEnv(TEST_PEOPLE);
  const result = await teardownLiveSystems(people);
  for (const line of result.lines) {
    console.log(line);
  }
}

await main();
