import { McpToolError, type McpCallRequest, type McpCallResult, type McpToolCaller } from "./types.js";
import { RateLimiter, sleep, withRetries } from "./rate-limit.js";

export interface RemoteMcpServerConfig {
  /** Absolute MCP endpoint URL (as registered in TrueForge). */
  url: string;
  /** Auth / routing headers TrueForge would send (e.g. Authorization Bearer). */
  headers?: Record<string, string>;
}

export interface RemoteMcpToolCallerOptions {
  /** Map of TrueForge MCP server name → endpoint config. */
  servers: Record<string, RemoteMcpServerConfig>;
  /** Max MCP calls per second (soft). Default 5. */
  maxPerSecond?: number;
}

/**
 * Speaks MCP JSON-RPC `tools/call` to remote servers that TrueForge has configured.
 * Connectors depend only on {@link McpToolCaller}; this is the host-side bridge.
 *
 * Note: TrueForge's HTTP API lists tools (`GET /api/v1/mcp-servers/{name}/tools`)
 * but does not yet expose a generic tools/call route — so the host invokes the
 * same remote MCP URLs the harness is configured with.
 */
export function createRemoteMcpToolCaller(
  options: RemoteMcpToolCallerOptions,
): McpToolCaller {
  const limiter = new RateLimiter(options.maxPerSecond ?? 5, options.maxPerSecond ?? 5);

  return {
    async callTool(request: McpCallRequest): Promise<McpCallResult> {
      const server = options.servers[request.server];
      if (!server) {
        throw new McpToolError(
          `MCP server "${request.server}" is not configured (register it in TrueForge Settings → Connectors)`,
          { server: request.server, tool: request.tool },
        );
      }

      await limiter.removeToken(request.signal);

      return withRetries(
        async () => {
          request.signal?.throwIfAborted();
          const response = await fetch(server.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              ...(server.headers ?? {}),
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: crypto.randomUUID(),
              method: "tools/call",
              params: {
                name: request.tool,
                arguments: request.arguments ?? {},
              },
            }),
            signal: request.signal,
          });

          if (response.status === 429) {
            const retryAfter = Number(response.headers.get("retry-after") ?? "1");
            await sleep(Math.max(250, retryAfter * 1000), request.signal);
            throw new McpToolError("rate limited", {
              server: request.server,
              tool: request.tool,
              status: 429,
            });
          }

          if (!response.ok) {
            throw new McpToolError(
              `MCP HTTP ${response.status}: ${await response.text()}`,
              { server: request.server, tool: request.tool, status: response.status },
            );
          }

          const payload = (await response.json()) as {
            result?: unknown;
            error?: { message?: string };
          };
          if (payload.error) {
            throw new McpToolError(payload.error.message ?? "MCP tool error", {
              server: request.server,
              tool: request.tool,
            });
          }

          return {
            server: request.server,
            tool: request.tool,
            data: unwrapMcpResult(payload.result),
          };
        },
        { signal: request.signal },
      );
    },
  };
}

/**
 * Build a caller from TrueForge base URL + explicit server endpoint map.
 * Verifies servers exist via `GET /api/v1/mcp-servers` when reachable.
 */
export function createTrueForgeMcpToolCaller(options: {
  trueforgeBaseUrl: string;
  servers: Record<string, RemoteMcpServerConfig>;
  token?: string;
}): McpToolCaller {
  const remote = createRemoteMcpToolCaller({ servers: options.servers });
  const base = options.trueforgeBaseUrl.replace(/\/$/, "");

  return {
    async callTool(request) {
      try {
        const headers: Record<string, string> = {};
        if (options.token) headers.Authorization = `Bearer ${options.token}`;
        const res = await fetch(`${base}/api/v1/mcp-servers`, {
          headers,
          signal: request.signal,
        });
        if (res.ok) {
          const body = (await res.json()) as { data?: Array<{ name?: string }> };
          const names = new Set((body.data ?? []).map((s) => s.name).filter(Boolean));
          if (names.size > 0 && !names.has(request.server)) {
            throw new McpToolError(
              `MCP server "${request.server}" not found in TrueForge registry`,
              { server: request.server, tool: request.tool, status: 404 },
            );
          }
        }
      } catch (error) {
        if (error instanceof McpToolError) throw error;
      }
      return remote.callTool(request);
    },
  };
}

function unwrapMcpResult(result: unknown): unknown {
  if (result === null || result === undefined) return result;
  if (typeof result !== "object") return result;
  const obj = result as Record<string, unknown>;
  if (Array.isArray(obj.content)) {
    const texts = obj.content
      .map((c) => {
        if (c && typeof c === "object" && "text" in c) {
          return String((c as { text: unknown }).text);
        }
        return null;
      })
      .filter((t): t is string => t !== null);
    if (texts.length === 1) {
      try {
        return JSON.parse(texts[0]!);
      } catch {
        return texts[0];
      }
    }
    if (texts.length > 1) {
      return texts.map((t) => {
        try {
          return JSON.parse(t);
        } catch {
          return t;
        }
      });
    }
  }
  if ("structuredContent" in obj) return obj.structuredContent;
  return result;
}
