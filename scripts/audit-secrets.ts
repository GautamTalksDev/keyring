/**
 * Scan working tree (+ git history when present) for leaked secrets.
 * Exit 1 if high-confidence hits are found.
 */
import { execSync } from "node:child_process";
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

const ALLOW_SUBSTRINGS = [
  "AKIA_KEYRING_CI_ORPHAN_LOOKALIKE",
  "example",
  "YOUR_",
  "placeholder",
];

type Hit = { file: string; name: string; line: number; excerpt: string };

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
      /\.(ts|tsx|js|mjs|cjs|json|yml|yaml|md|env|sh|toml)$/i.test(ent.name) ||
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
          excerpt: line.trim().slice(0, 120),
        });
      }
    }
  }
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

  let historyNote = "no .git directory — working tree only";
  const gitDir = path.join(root, ".git");
  if (fs.existsSync(gitDir)) {
    historyNote = "scanned git history (git grep -a)";
    try {
      const out = execSync(
        `git -C "${root}" grep -a -n -E "sk-(live|proj)-|sk-ant-api|ghp_|github_pat_|AKIA[0-9A-Z]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY" || true`,
        { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      );
      for (const line of out.split("\n").filter(Boolean)) {
        if (ALLOW_SUBSTRINGS.some((a) => line.includes(a))) continue;
        hits.push({
          file: `(history) ${line.slice(0, 80)}`,
          name: "git-grep",
          line: 0,
          excerpt: line.slice(0, 160),
        });
      }
    } catch (err) {
      historyNote = `git history scan failed: ${err}`;
    }
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
