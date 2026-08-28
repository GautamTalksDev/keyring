import type { McpCallResult, McpToolCaller } from "./types.js";

export interface PageResult<T> {
  items: T[];
  /** Next page number (GitHub-style) or page token (Google-style). */
  nextPage?: number;
  nextPageToken?: string;
}

/**
 * Walk numbered pages until exhausted.
 */
export async function* paginatePages<T>(
  fetchPage: (page: number) => Promise<PageResult<T>>,
  opts: { startPage?: number; maxPages?: number; signal?: AbortSignal } = {},
): AsyncGenerator<T> {
  let page = opts.startPage ?? 1;
  const maxPages = opts.maxPages ?? 100;
  for (let i = 0; i < maxPages; i++) {
    opts.signal?.throwIfAborted();
    const result = await fetchPage(page);
    for (const item of result.items) {
      yield item;
    }
    if (result.nextPage === undefined || result.nextPage === page) {
      if (result.items.length === 0 || result.nextPage === undefined) return;
    }
    if (result.nextPage === undefined) return;
    page = result.nextPage;
  }
}

/**
 * Walk opaque page tokens until exhausted.
 */
export async function* paginateTokens<T>(
  fetchPage: (pageToken: string | undefined) => Promise<PageResult<T>>,
  opts: { maxPages?: number; signal?: AbortSignal } = {},
): AsyncGenerator<T> {
  let token: string | undefined;
  const maxPages = opts.maxPages ?? 100;
  for (let i = 0; i < maxPages; i++) {
    opts.signal?.throwIfAborted();
    const result = await fetchPage(token);
    for (const item of result.items) {
      yield item;
    }
    if (!result.nextPageToken) return;
    token = result.nextPageToken;
  }
}

export function asObject(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  if (typeof data === "string") {
    try {
      const parsed: unknown = JSON.parse(data);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
  }
  return {};
}

export function asArray(data: unknown, key?: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (key) {
    const obj = asObject(data);
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export async function callJson(
  mcp: McpToolCaller,
  server: string,
  tool: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<McpCallResult> {
  return mcp.callTool({ server, tool, arguments: args, signal });
}
