import { describe, expect, it } from "vitest";

import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("removes credentials from serialized output", () => {
    const bearer = `Bearer ${"A".repeat(24)}`;
    const accessKey = `AKIA${"B".repeat(16)}`;
    const output = JSON.stringify(
      redactSecrets({
        api_key: "provider-secret",
        authorization: bearer,
        evidence: [{ raw: { access_token: "session-secret", accessKey } }],
      }),
    );

    expect(output).not.toContain("provider-secret");
    expect(output).not.toContain("session-secret");
    expect(output).not.toContain(bearer);
    expect(output).not.toContain(accessKey);
    expect(output).toContain("[REDACTED]");
  });
});
