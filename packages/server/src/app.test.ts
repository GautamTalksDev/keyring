import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";

describe("createApp", () => {
  it("responds to /health with mcp and api mounts", async () => {
    const app = createApp(Fastify());
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      mcp: { scan: "/mcp/scan", mutate: "/mcp/mutate" },
      api: { scans: "POST /scans" },
    });
    await app.close();
  });

  it("lists scan tools over MCP JSON-RPC", async () => {
    const app = createApp(Fastify());
    const response = await app.inject({
      method: "POST",
      url: "/mcp/scan",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      result: { tools: Array<{ name: string }> };
    };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain("list_connected_systems");
    expect(names).toContain("inventory_system");
    expect(names).not.toContain("revoke_grant");
    await app.close();
  });

  it("lists mutate tools with revoke only", async () => {
    const app = createApp(Fastify());
    const response = await app.inject({
      method: "POST",
      url: "/mcp/mutate",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    const body = response.json() as {
      result: { tools: Array<{ name: string }> };
    };
    expect(body.result.tools.map((t) => t.name)).toEqual(["revoke_grant"]);
    await app.close();
  });

  it("returns 503 for product API without db", async () => {
    const app = createApp(Fastify(), { db: null });
    const response = await app.inject({
      method: "POST",
      url: "/scans",
      payload: { person: "Ada" },
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("rejects malformed MCP requests without exposing internals", async () => {
    const app = createApp(Fastify());
    const response = await app.inject({
      method: "POST",
      url: "/mcp/scan",
      payload: { jsonrpc: "2.0", id: 1, method: 42 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      error: { code: -32600, message: "Invalid JSON-RPC request" },
    });
    expect(response.body).not.toMatch(/\/home\/|node_modules|\.ts:/);
    await app.close();
  });

  it("returns generic errors for unknown routes", async () => {
    const app = createApp(Fastify());
    const response = await app.inject({ method: "GET", url: "/does-not-exist" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "not_found" });
    expect(response.body).not.toMatch(/stack|node_modules|\.ts:/i);
    await app.close();
  });
});
