import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ScanRecording } from "./types.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export function recordingsDir(): string {
  return (
    process.env.KEYRING_RECORDINGS_DIR ??
    path.join(repoRoot, "fixtures/recordings")
  );
}

export function recordingPath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(recordingsDir(), `${safe}.json`);
}

export async function saveRecording(recording: ScanRecording): Promise<string> {
  await mkdir(recordingsDir(), { recursive: true });
  const dest = recordingPath(recording.id);
  await writeFile(dest, `${JSON.stringify(recording, null, 2)}\n`, "utf8");
  return dest;
}

export async function loadRecording(id: string): Promise<ScanRecording> {
  const raw = await readFile(recordingPath(id), "utf8");
  const doc = JSON.parse(raw) as ScanRecording;
  if (doc.version !== 1) {
    throw new Error(`Unsupported recording version: ${String(doc.version)}`);
  }
  return doc;
}

export async function listRecordings(): Promise<string[]> {
  try {
    const files = await readdir(recordingsDir());
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}
