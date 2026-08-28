import { describe, expect, it } from "vitest";

import { classifyClientError, recoveryFor } from "./errors.js";

describe("client error recovery", () => {
  it("maps auth messages to connector_auth with recovery text", () => {
    expect(classifyClientError("401 unauthorized from GitHub MCP")).toBe(
      "connector_auth",
    );
    expect(recoveryFor("connector_auth")).toMatch(/Re-authorize/);
  });

  it("maps rate limits", () => {
    expect(classifyClientError("429 Too Many Requests")).toBe("rate_limit");
    expect(recoveryFor("rate_limit")).toMatch(/retry/i);
  });

  it("maps spend caps and partial scans", () => {
    expect(classifyClientError("Hard spend cap reached")).toBe("cost_capped");
    expect(classifyClientError("Partial scan — 1 system(s) failed")).toBe(
      "partial",
    );
  });
});
