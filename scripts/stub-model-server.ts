/**
 * Zero-cost OpenAI-compatible chat completions stub for Keyring fixture demos.
 *
 * Register in TrueForge as a custom provider (base_url → this server).
 * Drives the audit flow with tool calls against keyring-scan MCP tools.
 * Detects subagent prompts (system inventory) vs root agent.
 *
 * Usage:
 *   pnpm stub:model
 *   # listens on :4099  POST /v1/chat/completions
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.KEYRING_STUB_MODEL_PORT ?? 4099);

type ChatMessage = {
  role: string;
  content?: string | Array<{ type?: string; text?: string }> | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

type ToolDef = {
  type: string;
  function: { name: string; description?: string; parameters?: unknown };
};

function messageText(m: ChatMessage): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content.map((p) => p.text ?? "").join("");
  }
  return "";
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

function toolCall(name: string, args: Record<string, unknown>, id?: string) {
  return {
    id: id ?? `call_${name}_${Math.random().toString(36).slice(2, 8)}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function completionWithTools(
  toolCalls: ReturnType<typeof toolCall>[],
  content: string | null = null,
) {
  return {
    id: `chatcmpl_stub_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "keyring-stub",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          tool_calls: toolCalls,
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function completionText(content: string) {
  return {
    id: `chatcmpl_stub_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "keyring-stub",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

function findTool(tools: ToolDef[] | undefined, names: string[]): string | null {
  if (!tools) return null;
  for (const n of names) {
    if (tools.some((t) => t.function?.name === n)) return n;
  }
  // fuzzy
  for (const t of tools) {
    const name = t.function?.name ?? "";
    if (names.some((n) => name.toLowerCase().includes(n.toLowerCase()))) {
      return name;
    }
  }
  return null;
}

function lastToolResult(messages: ChatMessage[], toolName?: string): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "tool") {
      if (!toolName || m.name === toolName) return messageText(m);
    }
  }
  return null;
}

function extractPersonHint(messages: ChatMessage[]): string | undefined {
  const user = [...messages].reverse().find((m) => m.role === "user");
  const text = user ? messageText(user) : "";
  const m =
    text.match(/audit access for\s+(.+)/i) ||
    text.match(/offboard\s+(.+)/i) ||
    text.match(/for\s+([A-Za-z][A-Za-z .'-]+)/);
  return m?.[1]?.trim().replace(/[?.!]+$/, "");
}

function parseSystems(toolJson: string | null): Array<{ id: string }> {
  if (!toolJson) return [];
  try {
    const parsed = JSON.parse(toolJson) as {
      systems?: Array<{ id: string }>;
      content?: Array<{ text?: string }>;
    };
    if (parsed.systems) return parsed.systems;
    // MCP tool result may be wrapped
    if (parsed.content?.[0]?.text) {
      const inner = JSON.parse(parsed.content[0].text) as {
        systems?: Array<{ id: string }>;
      };
      return inner.systems ?? [];
    }
  } catch {
    /* ignore */
  }
  // try to find systems array in text
  try {
    const match = toolJson.match(/\{[\s\S]*"systems"[\s\S]*\}/);
    if (match) {
      const inner = JSON.parse(match[0]) as { systems?: Array<{ id: string }> };
      return inner.systems ?? [];
    }
  } catch {
    /* ignore */
  }
  return [];
}

function unwrapMcpText(raw: string | null): unknown {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { content?: Array<{ text?: string }> };
    if (parsed.content?.[0]?.text) return JSON.parse(parsed.content[0].text);
    return parsed;
  } catch {
    return raw;
  }
}

function decide(messages: ChatMessage[], tools: ToolDef[] | undefined) {
  const blob = messages.map((m) => `${m.role}:${messageText(m)}`).join("\n").toLowerCase();

  // Subagent: inventory a single system
  const systemMatch =
    blob.match(/system_id[=:\s]+([a-z0-9_]+)/i) ||
    blob.match(/inventory(?:_system)?\s+(?:for\s+)?([a-z0-9_]+)/i) ||
    blob.match(/connected system[:\s]+([a-z0-9_]+)/i);
  const inventoryName = findTool(tools, ["inventory_system"]);
  if (inventoryName && systemMatch && !blob.includes("list_connected_systems")) {
    // If we already have inventory tool result, finish subagent
    const inv = lastToolResult(messages);
    if (inv && (inv.includes("grants") || inv.includes("systemId"))) {
      const data = unwrapMcpText(inv) as { systemId?: string; count?: number };
      return completionText(
        JSON.stringify({
          systemId: data?.systemId ?? systemMatch[1],
          count: data?.count ?? 0,
          grants: (data as { grants?: unknown }).grants ?? [],
          note: "compact grants only — raw API JSON discarded",
        }),
      );
    }
    return completionWithTools([
      toolCall(inventoryName, {
        system_id: systemMatch[1],
        delay_ms_per_grant: Number(process.env.KEYRING_SCAN_DELAY_MS ?? 800),
      }),
    ]);
  }

  const listName = findTool(tools, ["list_connected_systems"]);
  const reconcileName = findTool(tools, ["run_identity_reconciliation"]);
  const persistName = findTool(tools, ["persist_approval_cards"]);
  const subAgentName = findTool(tools, [
    "create_sub_agent",
    "create_subagent",
    "spawn_sub_agent",
    "run_sub_agent",
  ]);

  const listed = messages.some(
    (m) =>
      m.role === "tool" &&
      (messageText(m).includes("systems") || m.name === "list_connected_systems"),
  );
  const reconciled = messages.some(
    (m) =>
      m.role === "tool" &&
      (messageText(m).includes("reconciliation") ||
        m.name === "run_identity_reconciliation"),
  );
  const persisted = messages.some(
    (m) =>
      m.role === "tool" &&
      (messageText(m).includes('"stop": true') ||
        messageText(m).includes("Scan complete") ||
        m.name === "persist_approval_cards"),
  );

  if (persisted) {
    return completionText(
      "Scan complete. ApprovalCards are persisted. I am stopping without any revoke — every mutating action needs your harness approval via keyring-mutate. Review the queue (CI trap grants remain held).",
    );
  }

  if (!listed && listName) {
    return completionWithTools([toolCall(listName, {})]);
  }

  // After list: spawn subagents (or inventory sequentially if harness tool missing)
  const systems = parseSystems(lastToolResult(messages, "list_connected_systems") ?? lastToolResult(messages));
  const hasSubagentResults =
    messages.filter((m) => m.role === "tool" && messageText(m).includes("grants")).length >=
    Math.max(1, systems.length);

  if (listed && !hasSubagentResults && systems.length > 0) {
    if (subAgentName) {
      // One tool call nesting multiple subagents if schema allows array; else first system
      // TrueForge typically accepts instructions + maybe parallel calls — emit one call per system.
      return completionWithTools(
        systems.map((s) =>
          toolCall(subAgentName, {
            instructions: `Inventory connected system_id=${s.id} using inventory_system. Return only the compact grants JSON from the tool. Do not call revoke or mutate tools.`,
            title: `scan:${s.id}`,
          }),
        ),
      );
    }
    if (inventoryName) {
      return completionWithTools(
        systems.map((s) =>
          toolCall(inventoryName, {
            system_id: s.id,
            delay_ms_per_grant: Number(process.env.KEYRING_SCAN_DELAY_MS ?? 800),
          }),
        ),
      );
    }
  }

  // Collect grant ids from inventory tool messages
  const grantIds = new Set<string>();
  for (const m of messages) {
    if (m.role !== "tool") continue;
    const text = messageText(m);
    if (!text.includes("grant")) continue;
    try {
      const data = unwrapMcpText(text) as { grants?: Array<{ id: string }> };
      for (const g of data?.grants ?? []) {
        if (g.id) grantIds.add(g.id);
      }
    } catch {
      const ids = text.match(/"id"\s*:\s*"([^"]+)"/g) ?? [];
      for (const raw of ids) {
        const id = raw.match(/"id"\s*:\s*"([^"]+)"/)?.[1];
        if (id && id.length > 8) grantIds.add(id);
      }
    }
  }

  const personHint = extractPersonHint(messages);

  if (!reconciled && reconcileName && grantIds.size > 0) {
    return completionWithTools([
      toolCall(reconcileName, {
        grant_ids: [...grantIds],
        ...(personHint ? { person_hint: personHint } : {}),
      }),
    ]);
  }

  if (reconciled && persistName) {
    const reconRaw = lastToolResult(messages, "run_identity_reconciliation") ?? lastToolResult(messages);
    const recon = unwrapMcpText(reconRaw) as {
      reconciliation?: unknown;
    };
    return completionWithTools([
      toolCall(persistName, {
        grant_ids: [...grantIds],
        reconciliation: recon?.reconciliation ?? recon,
        ...(personHint ? { person_hint: personHint } : {}),
      }),
    ]);
  }

  // Fallback: if we listed but couldn't parse systems, inventory known fixture systems
  if (listed && inventoryName && !reconciled) {
    const fallback = ["aws", "github", "google_workspace", "notion", "slack"];
    return completionWithTools(
      fallback.map((id) =>
        toolCall(inventoryName, {
          system_id: id,
          delay_ms_per_grant: Number(process.env.KEYRING_SCAN_DELAY_MS ?? 800),
        }),
      ),
    );
  }

  return completionText(
    "I need keyring-scan MCP tools (list_connected_systems, inventory_system, run_identity_reconciliation, persist_approval_cards) to continue the audit.",
  );
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, GET, OPTIONS",
      "access-control-allow-headers": "*",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && (req.url === "/health" || req.url === "/v1/models")) {
    json(res, 200, {
      object: "list",
      data: [{ id: "keyring-stub", object: "model", owned_by: "keyring" }],
    });
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/v1/chat/completions")) {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as {
      messages: ChatMessage[];
      tools?: ToolDef[];
    };
    const out = decide(body.messages ?? [], body.tools);
    json(res, 200, out);
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Keyring stub model on http://127.0.0.1:${port}/v1 (OpenAI-compatible)`);
  console.log(`  POST /v1/chat/completions`);
  console.log(`  Set KEYRING_SCAN_DELAY_MS to slow inventory for reconnect demos (default 800)`);
});
