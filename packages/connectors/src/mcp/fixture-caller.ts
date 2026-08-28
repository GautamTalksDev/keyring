import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpToolError, type McpCallRequest, type McpCallResult, type McpToolCaller } from "./types.js";

const defaultMcpFixturesDir = fileURLToPath(new URL("../../fixtures/mcp", import.meta.url));

export interface FixtureMcpToolCallerOptions {
  /** Directory containing `{server}/{tool}.json` (or `.page-{n}.json`) responses. */
  fixturesDir?: string;
}

/**
 * Contract-test MCP caller: serves canned tool responses from fixtures/mcp.
 * No network — development and CI use this exclusively by default.
 */
export function createFixtureMcpToolCaller(
  options: FixtureMcpToolCallerOptions = {},
): McpToolCaller {
  const root = options.fixturesDir ?? defaultMcpFixturesDir;

  return {
    async callTool(request: McpCallRequest): Promise<McpCallResult> {
      const page =
        typeof request.arguments?.page === "number"
          ? request.arguments.page
          : typeof request.arguments?.pageToken === "string"
            ? request.arguments.pageToken
            : undefined;

      const candidates = [
        page !== undefined
          ? path.join(root, request.server, `${request.tool}.page-${page}.json`)
          : null,
        path.join(root, request.server, `${request.tool}.json`),
      ].filter((p): p is string => p !== null);

      let raw: string | undefined;
      let usedPath: string | undefined;
      for (const candidate of candidates) {
        try {
          raw = await readFile(candidate, "utf8");
          usedPath = candidate;
          break;
        } catch {
          // try next
        }
      }

      if (raw === undefined || usedPath === undefined) {
        throw new McpToolError(
          `No MCP fixture for ${request.server}/${request.tool} (looked in ${root})`,
          { server: request.server, tool: request.tool, status: 404 },
        );
      }

      const parsed: unknown = JSON.parse(raw);
      const data = resolveFixturePayload(parsed, request);

      return {
        server: request.server,
        tool: request.tool,
        data,
      };
    },
  };
}

function resolveFixturePayload(parsed: unknown, request: McpCallRequest): unknown {
  // Allow { when: { argsMatch }, response }[] for multi-key tools
  if (Array.isArray(parsed) && parsed.length > 0 && isCaseEntry(parsed[0])) {
    const args = request.arguments ?? {};
    for (const entry of parsed) {
      if (!isCaseEntry(entry)) continue;
      if (matchesArgs(entry.when ?? {}, args)) {
        return entry.response;
      }
    }
    const fallback = parsed.find((e) => isCaseEntry(e) && e.default);
    if (fallback && isCaseEntry(fallback)) return fallback.response;
    throw new McpToolError(
      `No fixture case matched for ${request.server}/${request.tool}`,
      { server: request.server, tool: request.tool },
    );
  }
  return parsed;
}

function isCaseEntry(
  value: unknown,
): value is { when?: Record<string, unknown>; response: unknown; default?: boolean } {
  return (
    value !== null &&
    typeof value === "object" &&
    "response" in value
  );
}

function matchesArgs(
  when: Record<string, unknown>,
  args: Record<string, unknown>,
): boolean {
  for (const [key, expected] of Object.entries(when)) {
    if (args[key] !== expected) return false;
  }
  return true;
}
