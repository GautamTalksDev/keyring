import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanWorkingTree } from "./audit-secrets.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("working tree secret audit", () => {
  it("finds a high-confidence secret in a temporary file", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keyring-secret-audit-"));
    tempDirectories.push(directory);
    fs.writeFileSync(
      path.join(directory, "credentials.ts"),
      `const token = "ghp_${"a".repeat(36)}";\n`,
    );

    const result = scanWorkingTree(directory);

    expect(result.hits).toEqual([
      expect.objectContaining({
        file: "credentials.ts",
        name: "GitHub PAT",
        line: 1,
      }),
    ]);
  });
});
