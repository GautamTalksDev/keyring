import { describe, expect, it } from "vitest";

import { classifyProductError } from "./classify.js";

describe("classifyProductError", () => {
  it("detects connector auth failures", () => {
    const c = classifyProductError(
      Object.assign(new Error("GitHub MCP unauthorized"), { status: 401 }),
    );
    expect(c.kind).toBe("connector_auth");
    expect(c.recovery).toMatch(/Re-authorize/);
  });

  it("detects rate limits", () => {
    const c = classifyProductError(
      Object.assign(new Error("Too Many Requests"), { status: 429 }),
    );
    expect(c.kind).toBe("rate_limit");
    expect(c.recovery).toMatch(/rate/);
  });

  it("detects spend caps", () => {
    const c = classifyProductError(new Error("Hard spend cap reached ($0.50)"));
    expect(c.kind).toBe("cost_capped");
  });
});
