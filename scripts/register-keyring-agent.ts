#!/usr/bin/env tsx
/**
 * Register Keyring MCP connectors, model provider, and agent with TrueForge.
 *
 * Keys come from env only — never written to agent.json, logs (beyond presence), or the UI.
 *
 *   OPENAI_API_KEY=…          → register openai provider (preferred)
 *   ANTHROPIC_API_KEY=…       → register anthropic if no OpenAI key
 *   else                      → optional stub (KEYRING_ALLOW_STUB=1)
 *
 * Usage:
 *   pnpm register:agent
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = (process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8791").replace(
  /\/$/,
  "",
);
const keyringUrl = (process.env.KEYRING_BASE_URL ?? "http://localhost:3001").replace(
  /\/$/,
  "",
);
const stubModelUrl = (
  process.env.KEYRING_STUB_MODEL_URL ?? "http://host.docker.internal:4099/v1"
).replace(/\/$/, "");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function tf(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(process.env.TRUEFORGE_TOKEN
        ? { authorization: `Bearer ${process.env.TRUEFORGE_TOKEN}` }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

async function upsertMcp(name: string, url: string, description: string) {
  const manifest = {
    type: "remote",
    name,
    url,
    description,
  };
  let r = await tf("PUT", "/api/v1/settings/mcp-servers", { manifest });
  if (r.status === 404 || r.status === 405) {
    r = await tf("POST", "/api/v1/settings/mcp-servers", { manifest });
  }
  if (!r.ok && r.status === 409) {
    r = await tf("PUT", `/api/v1/mcp-servers/${name}`, { manifest });
  }
  console.log(`MCP ${name}: ${r.status}`, r.ok ? "ok" : "failed");
  return r.ok;
}

async function upsertOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return false;
  const manifest = {
    type: "openai",
    auth: { api_key: apiKey },
    models: [
      {
        model_id: "gpt-4o-mini",
        name: "gpt-4o-mini",
        properties: { context_length: 128000, max_output_tokens: 16384 },
      },
      {
        model_id: "gpt-4o",
        name: "gpt-4o",
        properties: { context_length: 128000, max_output_tokens: 16384 },
      },
    ],
  };
  let r = await tf("PUT", "/api/v1/settings/model-providers", { manifest });
  if (!r.ok) r = await tf("POST", "/api/v1/settings/model-providers", { manifest });
  console.log(
    `Model provider openai: ${r.status}`,
    r.ok ? "ok (key from OPENAI_API_KEY)" : "failed",
  );
  return r.ok;
}

async function upsertAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return false;
  const manifest = {
    type: "anthropic",
    auth: { api_key: apiKey },
    models: [
      {
        model_id: "claude-haiku-4-5",
        name: "claude-haiku-4-5",
        properties: { context_length: 200000, max_output_tokens: 8192 },
      },
      {
        model_id: "claude-sonnet-4-6",
        name: "claude-sonnet-4-6",
        properties: { context_length: 200000, max_output_tokens: 8192 },
      },
    ],
  };
  let r = await tf("PUT", "/api/v1/settings/model-providers", { manifest });
  if (!r.ok) r = await tf("POST", "/api/v1/settings/model-providers", { manifest });
  console.log(
    `Model provider anthropic: ${r.status}`,
    r.ok ? "ok (key from ANTHROPIC_API_KEY)" : "failed",
  );
  return r.ok;
}

async function upsertStubModel() {
  if (process.env.KEYRING_ALLOW_STUB !== "1") {
    console.log("Stub model: skipped (set KEYRING_ALLOW_STUB=1 to enable)");
    return false;
  }
  const manifest = {
    type: "custom",
    name: "keyring-stub",
    base_url: stubModelUrl,
    auth: { api_key: process.env.KEYRING_STUB_API_KEY ?? "stub-local" },
    models: [
      {
        model_id: "keyring-stub",
        name: "keyring-stub",
        properties: { context_length: 128000, max_output_tokens: 8192 },
      },
    ],
  };
  let r = await tf("PUT", "/api/v1/settings/model-providers", { manifest });
  if (!r.ok) r = await tf("POST", "/api/v1/settings/model-providers", { manifest });
  console.log(`Model provider keyring-stub: ${r.status}`, r.ok ? "ok" : "failed");
  return r.ok;
}

async function upsertSkill() {
  const skillUrl = process.env.KEYRING_SKILL_GIT_URL;
  if (!skillUrl) {
    console.log(
      "Skill keyring-audit: skipped (set KEYRING_SKILL_GIT_URL to an https GitHub/GitLab repo containing skills/keyring-audit)",
    );
    return false;
  }
  const manifest = {
    type: "git",
    name: "keyring-audit",
    url: skillUrl,
    ref: process.env.KEYRING_SKILL_GIT_REF ?? "main",
    path: "skills/keyring-audit",
    description:
      "Audit/offboard playbook: subagent fan-out, sandbox reconcile, ApprovalCards, stop before revoke.",
  };
  let r = await tf("PUT", "/api/v1/settings/skills", { manifest });
  if (!r.ok) r = await tf("POST", "/api/v1/settings/skills", { manifest });
  console.log(`Skill keyring-audit: ${r.status}`, r.ok ? "ok" : "failed");
  return r.ok;
}

async function upsertAgent(skillRegistered: boolean) {
  const agentPath = path.join(repoRoot, "agents/keyring.agent.json");
  const full = JSON.parse(await readFile(agentPath, "utf8")) as {
    skills?: Array<{ name: string }>;
    keyring?: unknown;
    [k: string]: unknown;
  };
  // TrueForge AgentSpec — strip Keyring-only extension (costs / role models).
  const { keyring: _keyring, ...manifest } = full;
  void _keyring;
  if (!skillRegistered) {
    delete manifest.skills;
  }

  let r = await tf("POST", "/api/v1/agents", { name: "keyring", manifest });
  if (r.status === 409) {
    const listed = await tf("GET", "/api/v1/agents");
    const agents =
      (listed.json as { data?: Array<{ id: string; name: string }> })?.data ??
      (listed.json as Array<{ id: string; name: string }>) ??
      [];
    const existing = Array.isArray(agents)
      ? agents.find((a) => a.name === "keyring")
      : undefined;
    if (!existing?.id) {
      console.error("Agent name conflict but could not find keyring id");
      return false;
    }
    r = await tf("PUT", `/api/v1/agents/${existing.id}`, { manifest });
  }
  console.log(`Agent keyring: ${r.status}`, r.ok ? "ok" : "failed");
  return r.ok;
}

async function main() {
  console.log(`TrueForge: ${baseUrl}`);
  console.log(`Keyring:   ${keyringUrl}`);
  console.log(
    "Keys: OPENAI_API_KEY / ANTHROPIC_API_KEY are read from env only — never logged.",
  );

  const openai = await upsertOpenAI();
  const anthropic = openai ? false : await upsertAnthropic();
  if (!openai && !anthropic) {
    await upsertStubModel();
    if (process.env.KEYRING_ALLOW_STUB !== "1") {
      console.warn(
        "No OPENAI_API_KEY or ANTHROPIC_API_KEY — agent model FQN may not resolve until you add a provider in TrueForge Settings → Models.",
      );
    }
  }

  await upsertMcp(
    "keyring-scan",
    `${rewriteLocalhost(keyringUrl)}/mcp/scan`,
    "Keyring read-only scan: list systems, inventory, reconcile, persist ApprovalCards. No write credentials.",
  );
  await upsertMcp(
    "keyring-mutate",
    `${rewriteLocalhost(keyringUrl)}/mcp/mutate`,
    "Keyring mutate: revoke_grant only. Requires TrueForge human approval. Write credentials live here only.",
  );
  const skillOk = await upsertSkill();
  await upsertAgent(skillOk);
  console.log("\nDone. See docs/COSTS.md for role models, hard cap, and record/replay.");
}

function rewriteLocalhost(url: string): string {
  if (process.env.KEYRING_MCP_PUBLIC_URL) {
    return process.env.KEYRING_MCP_PUBLIC_URL.replace(/\/$/, "");
  }
  if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    return url;
  }
  return url
    .replace("://localhost", "://host.docker.internal")
    .replace("://127.0.0.1", "://host.docker.internal");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
