import type { FastifyInstance } from "fastify";

import type { Database } from "./db/client.js";
import { registerApiRoutes } from "./api/routes.js";
import { registerMcpRoutes } from "./mcp/http.js";

export interface AppOptions {
  /** Product DB required for /scans, /cards, /audit. */
  db?: Database["db"] | null;
}

/**
 * HTTP API for the UI + Keyring MCP mounts for TrueForge.
 * Agent loop / harness approvals / subagents stay in TrueForge.
 */
export function createApp(
  app: FastifyInstance,
  opts: AppOptions = {},
): FastifyInstance {
  const db = opts.db ?? null;

  app.get("/health", async () => ({
    status: "ok",
    mcp: {
      scan: "/mcp/scan",
      mutate: "/mcp/mutate",
    },
    api: {
      scans: "POST /scans",
      stream: "GET /scans/:id/stream",
      cards: "GET /scans/:id/cards",
      decision: "POST /cards/:id/decision",
      execute: "POST /scans/:id/execute",
      audit: "GET /audit",
      auditExport: "GET /audit/export",
    },
  }));

  registerMcpRoutes(app, { db });

  if (db) {
    registerApiRoutes(app, { db });
  } else {
    app.addHook("onRequest", async (req, reply) => {
      const path = req.url.split("?")[0] ?? "";
      if (
        path.startsWith("/scans") ||
        path.startsWith("/cards") ||
        path.startsWith("/audit")
      ) {
        return reply.code(503).send({
          error: "database_unavailable",
          message: "Set DATABASE_URL to enable the product HTTP API",
        });
      }
    });
  }

  return app;
}
