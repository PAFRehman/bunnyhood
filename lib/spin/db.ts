import postgres from "postgres";
import { requireEnv } from "./config";

type Database = ReturnType<typeof postgres>;

declare global {
  var bunnyHoodSpinDb: Database | undefined;
}

export function getDb() {
  if (!globalThis.bunnyHoodSpinDb) {
    globalThis.bunnyHoodSpinDb = postgres(requireEnv("DATABASE_URL"), {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      ssl: process.env.NODE_ENV === "production" ? "require" : undefined,
    });
  }
  return globalThis.bunnyHoodSpinDb;
}

export type SpinDb = Database;

export async function inTransaction<T>(handler: (sql: SpinDb) => Promise<T>) {
  const sql = getDb();
  return sql.begin(async (transaction) => handler(transaction as unknown as SpinDb));
}

