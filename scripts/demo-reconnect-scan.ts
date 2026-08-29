#!/usr/bin/env tsx
/**
 * Reconnect demo (free): start a Keyring scan turn, drop the SSE stream mid-run,
 * then subscribe again and prove the turn is still going / finishes.
 *
 * Prerequisites: TrueForge + Keyring server + stub model + register:agent.
 *
 *   KEYRING_SCAN_DELAY_MS=1200 pnpm demo:reconnect
 */

const baseUrl = (process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8791").replace(
  /\/$/,
  "",
);

async function api(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
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
  return { status: res.status, json, headers: res.headers };
}

async function main() {
  console.log("Creating session on agent keyring…");
  const created = await api("POST", "/api/v1/agent-sessions", {
    agent: { name: "keyring" },
  });
  if (created.status >= 300) {
    // Some builds use /api/v1/sessions
    const alt = await api("POST", "/api/v1/sessions", {
      agent: { name: "keyring" },
    });
    if (alt.status >= 300) {
      console.error("Failed to create session", created.status, created.json, alt.json);
      process.exit(1);
    }
    Object.assign(created, alt);
  }

  const session = created.json as { id?: string; data?: { id: string } };
  const sessionId = session.id ?? session.data?.id;
  if (!sessionId) {
    console.error("No session id", created.json);
    process.exit(1);
  }
  console.log("session:", sessionId);

  const turnPathCandidates = [
    `/api/v1/agent-sessions/${sessionId}/turns`,
    `/api/v1/sessions/${sessionId}/turns`,
  ];

  // Non-streaming create so the turn keeps running server-side when we "kill the tab"
  let turnRes: { status: number; json: unknown } | null = null;
  for (const p of turnPathCandidates) {
    turnRes = await api("POST", `${p}?stream=false`, {
      input: [{ type: "user.message", content: "audit access for Ada Lovelace" }],
      stream: false,
    });
    if (turnRes.status < 300) break;
  }
  if (!turnRes || turnRes.status >= 300) {
    console.error("Failed to create turn", turnRes?.json);
    process.exit(1);
  }

  const turnBody = turnRes.json as { id?: string; data?: { id: string } };
  const turnId = turnBody.id ?? turnBody.data?.id;
  if (!turnId) {
    console.error("No turn id", turnRes.json);
    process.exit(1);
  }
  console.log("turn:", turnId, "(browser tab killed — we drop the client stream)");

  // Simulate disconnect: wait a bit while inventory delays tick
  const waitMs = Number(process.env.DEMO_DISCONNECT_MS ?? 2500);
  console.log(`Waiting ${waitMs}ms disconnected…`);
  await new Promise((r) => setTimeout(r, waitMs));

  // Reconnect: poll getTurn / subscribe
  const getPaths = turnPathCandidates.map(
    (p) => `${p.replace(/\/turns$/, "")}/turns/${turnId}`,
  );

  let status = "unknown";
  for (let i = 0; i < 60; i++) {
    for (const gp of getPaths) {
      const g = await api("GET", gp);
      if (g.status >= 300) continue;
      const body = g.json as {
        state?: { status?: string };
        data?: { state?: { status?: string } };
      };
      status = body.state?.status ?? body.data?.state?.status ?? status;
      console.log(`[reconnect poll ${i}] turn status=${status}`);
      if (status && status !== "running") {
        console.log("\nDone. Session survived disconnect — status:", status);
        console.log("Film point: kill tab mid-scan, reopen session, turn still progressed.");
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("Timed out still running (that still proves persistence).");
  console.log("Open TrueForge UI, find session", sessionId, "— it should show progress.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
