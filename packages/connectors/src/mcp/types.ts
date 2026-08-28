/**
 * MCP tool access port. The host wires this to TrueForge-configured MCP servers;
 * connectors never call GitHub/Google SDKs directly.
 */
export interface McpCallRequest {
  /** MCP server name as registered in TrueForge (e.g. `github`, `google_workspace`). */
  server: string;
  tool: string;
  arguments?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface McpCallResult {
  /** Parsed tool payload (MCP content JSON / structured result). */
  data: unknown;
  /** Echo of server/tool for Evidence.source. */
  server: string;
  tool: string;
}

export interface McpToolCaller {
  callTool(request: McpCallRequest): Promise<McpCallResult>;
}

export class McpToolError extends Error {
  readonly server: string;
  readonly tool: string;
  readonly status?: number;

  constructor(
    message: string,
    opts: { server: string; tool: string; status?: number; cause?: unknown },
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "McpToolError";
    this.server = opts.server;
    this.tool = opts.tool;
    this.status = opts.status;
  }
}
