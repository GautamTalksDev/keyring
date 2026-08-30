import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Database } from "../db/client.js";
import {
  handleMutateTool,
  handleScanTool,
  mutateToolDefs,
  scanToolDefs,
  type JsonRpcRequest,
  type McpToolDef,
} from "./tools.js";

/**
 * Minimal Streamable-HTTP-friendly MCP surface for TrueForge remote connectors.
 * Implements initialize / tools/list / tools/call over JSON-RPC POST.
 *
 * Two mounts:
 *   /mcp/scan   — read-only inventory + reconcile + persist (no write creds)
 *   /mcp/mutate — revoke only (write creds); harness must require approval
 */
export function registerMcpRoutes(app: FastifyInstance, opts: { db: Database["db"] | null }): void {
  app.post("/mcp/scan", async (req, reply) => {
    await handleMcpPost(req, reply, {
      serverName: "keyring-scan",
      tools: scanToolDefs(),
      call: (name, args) => handleScanTool(name, args, { db: opts.db }),
    });
  });

  app.get("/mcp/scan", async (_req, reply) => {
    reply.header("content-type", "text/event-stream");
    reply.header("cache-control", "no-cache");
    reply.raw.write(": keyring-scan mcp ready\n\n");
    // Keep alive briefly for clients that probe GET; TrueForge uses POST.
    setTimeout(() => {
      try {
        reply.raw.end();
      } catch {
        /* ignore */
      }
    }, 1000);
  });

  app.post("/mcp/mutate", async (req, reply) => {
    await handleMcpPost(req, reply, {
      serverName: "keyring-mutate",
      tools: mutateToolDefs(),
      call: (name, args) => handleMutateTool(name, args, { db: opts.db }),
    });
  });

  app.get("/mcp/mutate", async (_req, reply) => {
    reply.header("content-type", "text/event-stream");
    reply.header("cache-control", "no-cache");
    reply.raw.write(": keyring-mutate mcp ready\n\n");
    setTimeout(() => {
      try {
        reply.raw.end();
      } catch {
        /* ignore */
      }
    }, 1000);
  });
}

async function handleMcpPost(
  req: FastifyRequest,
  reply: FastifyReply,
  cfg: {
    serverName: string;
    tools: McpToolDef[];
    call: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
  },
): Promise<void> {
  const body = req.body as JsonRpcRequest | JsonRpcRequest[];
  if (Array.isArray(body)) {
    const results = [];
    for (const item of body) {
      results.push(await dispatchOne(item, cfg));
    }
    return reply.send(results);
  }
  const result = await dispatchOne(body, cfg);
  if (result === null) {
    return reply.code(202).send();
  }
  return reply.send(result);
}

async function dispatchOne(
  body: unknown,
  cfg: {
    serverName: string;
    tools: McpToolDef[];
    call: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
  },
): Promise<Record<string, unknown> | null> {
  const parsed = jsonRpcRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid JSON-RPC request" },
    };
  }
  const request = parsed.data;
  const id = request.id ?? null;
  const method = request.method;

  // Notifications (no id) → 202
  if (id === undefined || id === null) {
    if (method === "notifications/initialized" || method === "notifications/cancelled") {
      return null;
    }
  }

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: cfg.serverName, version: "0.0.0" },
      },
    };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: cfg.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        })),
      },
    };
  }

  if (method === "tools/call") {
    const parsedParams = toolsCallParamsSchema.safeParse(request.params ?? {});
    if (!parsedParams.success) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "Invalid tools/call parameters" },
      };
    }
    const { name, arguments: args } = parsedParams.data;
    const allowed = cfg.tools.some((t) => t.name === name);
    if (!allowed) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      };
    }
    const toolResult = await cfg.call(name, args ?? {});
    return { jsonrpc: "2.0", id, result: toolResult };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

const jsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0").optional(),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

const toolsCallParamsSchema = z
  .object({
    name: z.string().min(1),
    arguments: z.record(z.unknown()).optional(),
  })
  .strict();
