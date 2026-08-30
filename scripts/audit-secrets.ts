/**
 * Scan working tree (+ git history when present) for leaked secrets.
 * Exit 1 if high-confidence hits are found.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  ".git",
  ".keyring-pglite",
  ".keyring-pglite-demo",
  "coverage",
  "data",
]);

/** High-confidence patterns (not fixtures like AKIA_KEYRING_CI_ORPHAN_LOOKALIKE). */
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: "OpenAI sk-live/proj",
    re: /\bsk-(?:live|proj)-[A-Za-z0-9]{20,}\b/,
  },
  {
    name: "Anthropic key",
    re: /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: "GitHub PAT",
    re: /\bghp_[A-Za-z0-9]{36}\b/,
  },
  {
    name: "GitHub fine-grained PAT",
    re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  },
  {
    name: "AWS access key (real-looking)",
    re: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    name: "Private key block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
];

type Hit = { file: string; name: string; line: number; excerpt: string };

const HISTORY_PATTERN = PATTERNS.map(({ re }) => re.source)
  .join("|")
  .replaceAll("(?:", "(")
  .replaceAll("\\d", "[0-9]");

function redactSecrets(value: string): string {
  return PATTERNS.reduce(
    (redacted, { re }) => redacted.replace(new RegExp(re.source, re.flags), "[REDACTED]"),
    value,
  );
}

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIR.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (
      /\.(ts|tsx|js|mjs|cjs|json|yml|yaml|md|env|sh|toml|pem|key|p12|pfx|credentials|secret)$/i.test(
        ent.name,
      ) ||
      ent.name.startsWith(".env")
    ) {
      out.push(p);
    }
  }
}

function scanText(file: string, text: string, hits: Hit[]): void {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (ALLOW_SUBSTRINGS.some((a) => line.includes(a))) continue;
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) {
        hits.push({
          file: path.relative(root, file),
          name,
          line: i + 1,
          excerpt: redactSecrets(line.trim()).slice(0, 120),
        });
      }
    }
  }
}

function scanGitHistory(hits: Hit[]): string {
  let commits: string[];
  try {
    commits = execFileSync("git", ["-C", root, "rev-list", "--all", "--reflog"], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    })
      .split("\n")
      .filter(Boolean);
  } catch (err) {
    return `git history scan failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  for (const commit of commits) {
    let output = "";
    try {
      output = execFileSync(
        "git",
        [
          "-C",
          root,
          "grep",
          "-a",
          "-n",
          "-E",
          HISTORY_PATTERN,
          commit,
          "--",
          ":(exclude)scripts/audit-secrets.ts",
        ],
        { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      );
    } catch (err) {
      const status =
        typeof err === "object" && err !== null && "status" in err
          ? err.status
          : undefined;
      if (status !== 1) {
        return `git history scan failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      continue;
    }

    for (const line of output.split("\n").filter(Boolean)) {
      const match = line.match(/^([^:]+):([^:]+):(\d+):(.*)$/s);
      if (!match) continue;
      hits.push({
        file: `(history ${match[1]!.slice(0, 12)}) ${match[2]!}`,
        name: "git-history",
        line: Number(match[3]),
        excerpt: redactSecrets(match[4]!.trim()).slice(0, 120),
      });
    }
  }
  return `scanned ${commits.length} commits`;
}

function main(): void {
  const hits: Hit[] = [];
  const files: string[] = [];
  walk(root, files);
  for (const f of files) {
    try {
      scanText(f, fs.readFileSync(f, "utf8"), hits);
    } catch {
      /* skip unreadable */
    }
  }

  let historyNote = "no .git directory, working tree only";
  const gitDir = path.join(root, ".git");
  if (fs.existsSync(gitDir)) {
    historyNote = scanGitHistory(hits);
  }

  console.log(`Secret audit: ${files.length} files; ${historyNote}`);
  if (hits.length === 0) {
    console.log("OK — no high-confidence secrets found.");
    return;
  }
  console.error(`FAIL — ${hits.length} hit(s):`);
  for (const h of hits) {
    console.error(`  [${h.name}] ${h.file}:${h.line}  ${h.excerpt}`);
  }
  process.exit(1);
}

main();
