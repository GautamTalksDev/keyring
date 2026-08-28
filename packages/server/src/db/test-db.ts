import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  openDatabase,
  runMigrations,
  type Database,
} from "./client.js";

/**
 * Open an isolated DB for integration tests.
 * Default: embedded PGlite (no Docker). Set KEYRING_TEST_POSTGRES=1 + DATABASE_URL for real Postgres.
 */
export async function openTestDatabase(
  label: string,
): Promise<{ db: Database["db"]; close: () => Promise<void>; kind: string }> {
  if (
    process.env.KEYRING_TEST_POSTGRES === "1" &&
    process.env.DATABASE_URL &&
    !process.env.DATABASE_URL.startsWith("pglite")
  ) {
    const handle = await openDatabase(process.env.DATABASE_URL);
    await runMigrations(process.env.DATABASE_URL);
    return { db: handle.db, close: handle.close, kind: handle.kind };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `keyring-${label}-`));
  const prev = {
    KEYRING_PGLITE: process.env.KEYRING_PGLITE,
    KEYRING_PGLITE_PATH: process.env.KEYRING_PGLITE_PATH,
    DATABASE_URL: process.env.DATABASE_URL,
  };
  process.env.KEYRING_PGLITE = "1";
  process.env.KEYRING_PGLITE_PATH = dir;
  delete process.env.DATABASE_URL;

  await runMigrations();
  const handle = await openDatabase();
  return {
    db: handle.db,
    kind: handle.kind,
    close: async () => {
      await handle.close();
      fs.rmSync(dir, { recursive: true, force: true });
      if (prev.KEYRING_PGLITE === undefined) delete process.env.KEYRING_PGLITE;
      else process.env.KEYRING_PGLITE = prev.KEYRING_PGLITE;
      if (prev.KEYRING_PGLITE_PATH === undefined) {
        delete process.env.KEYRING_PGLITE_PATH;
      } else {
        process.env.KEYRING_PGLITE_PATH = prev.KEYRING_PGLITE_PATH;
      }
      if (prev.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev.DATABASE_URL;
    },
  };
}
