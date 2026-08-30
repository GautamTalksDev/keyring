/**
 * Optional live overlays for the throwaway Google / GitHub / Slack orgs.
 * Credentials are read only from environment variables — never from files in git.
 */

import type { TestPerson } from "./dataset.ts";

export interface LiveSeedResult {
  lines: string[];
}

function requiredLiveEnv(): {
  githubToken?: string;
  githubOrg?: string;
  slackToken?: string;
  googleAccessToken?: string;
} {
  return {
    githubToken: process.env.GITHUB_TOKEN || process.env.KEYRING_GITHUB_TOKEN,
    githubOrg: process.env.GITHUB_ORG || process.env.KEYRING_GITHUB_ORG,
    slackToken: process.env.SLACK_BOT_TOKEN || process.env.KEYRING_SLACK_BOT_TOKEN,
    googleAccessToken: process.env.GOOGLE_ACCESS_TOKEN || process.env.KEYRING_GOOGLE_ACCESS_TOKEN,
  };
}

async function githubFetch(
  token: string,
  pathname: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function githubPendingInvitationIds(
  token: string,
  org: string,
  repo: string,
  user: string,
): Promise<{ ids: string[]; error?: string }> {
  const res = await githubFetch(token, `/repos/${org}/${repo}/invitations`);
  if (!res.ok) {
    return { ids: [], error: `${res.status} ${await res.text()}` };
  }
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) return { ids: [] };
  const ids = body
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
    )
    .filter((entry) => {
      const invitee = entry.invitee;
      return (
        typeof invitee === "object" &&
        invitee !== null &&
        (invitee as { login?: unknown }).login === user
      );
    })
    .map((entry) => entry.id)
    .filter((id): id is string | number => typeof id === "string" || typeof id === "number")
    .map(String);
  return { ids };
}

/**
 * Idempotent GitHub ensure: org repos exist (create if missing) and outside
 * collaborators are invited with the intended permission.
 */
async function seedGitHub(
  token: string,
  org: string,
  people: readonly TestPerson[],
  lines: string[],
): Promise<void> {
  const repos = [
    { name: "payments", permission: "push" as const },
    { name: "infra", permission: "admin" as const },
    { name: "crypto-notes", permission: "push" as const },
  ];

  for (const repo of repos) {
    const get = await githubFetch(token, `/repos/${org}/${repo.name}`);
    if (get.status === 404) {
      const created = await githubFetch(token, `/orgs/${org}/repos`, {
        method: "POST",
        body: JSON.stringify({
          name: repo.name,
          private: true,
          description: "keyring test-org fixture repo",
          auto_init: true,
        }),
      });
      if (!created.ok) {
        lines.push(
          `github: failed to create ${org}/${repo.name}: ${created.status} ${await created.text()}`,
        );
      } else {
        lines.push(`github: created ${org}/${repo.name}`);
      }
    } else if (get.ok) {
      lines.push(`github: repo ${org}/${repo.name} already exists`);
    } else {
      lines.push(`github: lookup ${org}/${repo.name} failed: ${get.status}`);
    }
  }

  const collabs: Array<{ user: string; repo: string; permission: string }> = [
    { user: people[0]!.githubUsername, repo: "payments", permission: "push" },
    { user: people[1]!.githubUsername, repo: "infra", permission: "admin" },
    { user: people[2]!.githubUsername, repo: "crypto-notes", permission: "push" },
  ];

  for (const c of collabs) {
    const res = await githubFetch(token, `/repos/${org}/${c.repo}/collaborators/${c.user}`, {
      method: "PUT",
      body: JSON.stringify({ permission: c.permission }),
    });
    // 201 creates an invitation; it does not grant access until accepted.
    if (res.status === 201) {
      lines.push(
        `github: pending invitation for ${c.user} on ${org}/${c.repo} (${c.permission}) [201; not a collaborator]`,
      );
    } else if (res.status === 204) {
      lines.push(
        `github: ensured collaborator ${c.user} on ${org}/${c.repo} (${c.permission}) [${res.status}]`,
      );
    } else {
      lines.push(
        `github: collaborator ${c.user} on ${org}/${c.repo}: ${res.status} ${await res.text()}`,
      );
    }
  }

  lines.push(
    "github: CI trap deploy key is fixture-only (create manually if you need it live — see docs/TEST_ORG.md)",
  );
}

async function seedSlack(
  token: string,
  people: readonly TestPerson[],
  lines: string[],
): Promise<void> {
  // Slack Web API: auth.test proves the token; channel invites need real channel IDs.
  const auth = await fetch("https://slack.com/api/auth.test", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await auth.json()) as { ok: boolean; error?: string; team?: string };
  if (!body.ok) {
    lines.push(`slack: auth.test failed: ${body.error ?? auth.status}`);
    return;
  }
  lines.push(`slack: authenticated to team ${body.team ?? "(unknown)"}`);
  lines.push(
    `slack: invite ${people.map((p) => p.workEmail).join(", ")} to #eng-general / #security / private #exec-comp manually or via admin API — channel IDs are env-specific`,
  );
}

async function seedGoogle(
  accessToken: string,
  people: readonly TestPerson[],
  lines: string[],
): Promise<void> {
  const about = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!about.ok) {
    lines.push(`google: Drive about failed: ${about.status} ${await about.text()}`);
    return;
  }
  const json = (await about.json()) as { user?: { emailAddress?: string } };
  lines.push(`google: Drive token ok as ${json.user?.emailAddress ?? "unknown"}`);
  lines.push(
    `google: share the fixture folders to work + personal emails (${people.map((p) => p.personalEmail).join(", ")}) — folder IDs are env-specific; fixtures remain source of truth`,
  );
}

export async function seedLiveSystems(people: readonly TestPerson[]): Promise<LiveSeedResult> {
  const env = requiredLiveEnv();
  const lines: string[] = [];

  if (env.githubToken && env.githubOrg) {
    await seedGitHub(env.githubToken, env.githubOrg, people, lines);
  } else {
    lines.push("github: skipped (need GITHUB_TOKEN + GITHUB_ORG)");
  }

  if (env.slackToken) {
    await seedSlack(env.slackToken, people, lines);
  } else {
    lines.push("slack: skipped (need SLACK_BOT_TOKEN)");
  }

  if (env.googleAccessToken) {
    await seedGoogle(env.googleAccessToken, people, lines);
  } else {
    lines.push("google: skipped (need GOOGLE_ACCESS_TOKEN)");
  }

  return { lines };
}

export async function teardownLiveSystems(people: readonly TestPerson[]): Promise<LiveSeedResult> {
  const env = requiredLiveEnv();
  const lines: string[] = [];

  if (env.githubToken && env.githubOrg) {
    const token = env.githubToken;
    const org = env.githubOrg;
    const removals = [
      { user: people[0]!.githubUsername, repo: "payments" },
      { user: people[1]!.githubUsername, repo: "infra" },
      { user: people[2]!.githubUsername, repo: "crypto-notes" },
    ];
    for (const r of removals) {
      const pending = await githubPendingInvitationIds(token, org, r.repo, r.user);
      if (pending.error) {
        lines.push(
          `github: invitation lookup ${r.user} on ${org}/${r.repo} failed: ${pending.error}`,
        );
      }
      for (const invitationId of pending.ids) {
        const invitation = await githubFetch(
          token,
          `/repos/${org}/${r.repo}/invitations/${invitationId}`,
          { method: "DELETE" },
        );
        if (invitation.status === 204 || invitation.status === 404) {
          lines.push(
            `github: removed/absent pending invitation ${invitationId} for ${r.user} on ${org}/${r.repo} [${invitation.status}]`,
          );
        } else {
          lines.push(
            `github: remove invitation ${invitationId} for ${r.user}: ${invitation.status} ${await invitation.text()}`,
          );
        }
      }
      const res = await githubFetch(token, `/repos/${org}/${r.repo}/collaborators/${r.user}`, {
        method: "DELETE",
      });
      if (res.status === 204 || res.status === 404) {
        lines.push(
          `github: removed/absent collaborator ${r.user} on ${org}/${r.repo} [${res.status}]`,
        );
      } else {
        lines.push(`github: remove ${r.user}: ${res.status} ${await res.text()}`);
      }
    }
    lines.push("github: repos left in place (delete the org manually if desired)");
  } else {
    lines.push("github: teardown skipped (need GITHUB_TOKEN + GITHUB_ORG)");
  }

  if (!env.slackToken) {
    lines.push("slack: teardown skipped (need SLACK_BOT_TOKEN)");
  } else {
    lines.push("slack: remove channel memberships manually in the throwaway workspace");
  }

  if (!env.googleAccessToken) {
    lines.push("google: teardown skipped (need GOOGLE_ACCESS_TOKEN)");
  } else {
    lines.push("google: remove Drive shares to personal Gmail addresses manually / via Drive API");
  }

  lines.push(
    "fixtures/: left intact (dev dataset). Delete fixtures/test-org only if you intend to.",
  );
  return { lines };
}
