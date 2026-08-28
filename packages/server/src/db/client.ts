import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import * as schema from "./schema.js";

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

/** Drizzle DB handle used across the server (postgres-js or PGlite). */
export type AppDb = ReturnType<typeof drizzlePg<typeof schema>>;

export type Database = {
  db: AppDb;
  close: () => Promise<void>;
  kind: "postgres" | "pglite";
};

export function usePgliteMode(): boolean {
  if (process.env.KEYRING_PGLITE === "1") return true;
  if (process.env.KEYRING_DEMO === "1" && !process.env.DATABASE_URL) return true;
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("pglite:") || url === "pglite";
}

function pgliteDataDir(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("pglite:") && url.length > "pglite:".length) {
    return url.slice("pglite:".length);
  }
  return (
    process.env.KEYRING_PGLITE_PATH ??
    path.resolve(process.cwd(), ".keyring-pglite")
  );
}

/**
 * Open product DB. Demo / no Docker → embedded PGlite (no credentials).
 * Otherwise postgres via DATABASE_URL.
 */
export async function openDatabase(
  connectionString = process.env.DATABASE_URL,
): Promise<Database> {
  if (usePgliteMode() || !connectionString) {
    const dir = pgliteDataDir();
    const client = new PGlite(dir);
    const db = drizzlePglite(client, { schema }) as unknown as AppDb;
    return {
      db,
      kind: "pglite",
      close: async () => {
        await client.close();
      },
    };
  }

  const client = postgres(connectionString, { max: 10 });
  const db = drizzlePg(client, { schema });
  return {
    db,
    kind: "postgres",
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}

/** @deprecated Prefer openDatabase — kept for sync call sites that pass a URL. */
export function createDb(connectionString: string): {
  db: AppDb;
  client: ReturnType<typeof postgres>;
} {
  const client = postgres(connectionString, { max: 10 });
  const db = drizzlePg(client, { schema });
  return { db, client };
}

export function requireDatabaseUrl(): string {
  if (usePgliteMode()) {
    return `pglite:${pgliteDataDir()}`;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required (or set KEYRING_DEMO=1 / KEYRING_PGLITE=1 for embedded PGlite)",
    );
  }
  return url;
}

export async function runMigrations(
  connectionString = requireDatabaseUrl(),
): Promise<void> {
  if (usePgliteMode() || connectionString.startsWith("pglite")) {
    const handle = await openDatabase(connectionString);
    try {
      await migratePglite(handle.db as never, { migrationsFolder });
    } finally {
      await handle.close();
    }
    return;
  }

  const { db, client } = createDb(connectionString);
  try {
    await migratePg(db, { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}
