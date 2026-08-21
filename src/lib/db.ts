import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * A single long-lived SQLite handle. Next's dev server re-evaluates modules on
 * every hot reload, so the connection is parked on globalThis to avoid leaking
 * file handles and re-running the schema on each edit.
 */
const globalForDb = globalThis as unknown as { starkvisionzDb?: Database.Database };

export function dbPath(): string {
  const configured = process.env.STARKVISIONZ_DB_PATH;
  if (configured && configured.trim()) return path.resolve(configured.trim());
  return path.join(process.cwd(), "data", "starkvisionz.db");
}

export function getDb(): Database.Database {
  if (globalForDb.starkvisionzDb) return globalForDb.starkvisionzDb;

  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);

  globalForDb.starkvisionzDb = db;
  return db;
}

/** Idempotent — every statement in schema.sql is CREATE ... IF NOT EXISTS. */
export function applySchema(db: Database.Database): void {
  const schemaFile = path.join(process.cwd(), "src", "lib", "schema.sql");
  const sql = fs.readFileSync(schemaFile, "utf8");
  db.exec(sql);
}

/** Typed SELECT returning many rows. */
export function all<T>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[];
}

/** Typed SELECT returning the first row, or undefined. */
export function one<T>(sql: string, params: unknown[] = []): T | undefined {
  return getDb().prepare(sql).get(...(params as never[])) as T | undefined;
}

/** INSERT / UPDATE / DELETE. */
export function run(sql: string, params: unknown[] = []) {
  return getDb().prepare(sql).run(...(params as never[]));
}

/** Whether the database has been seeded yet. */
export function isSeeded(): boolean {
  const row = one<{ n: number }>("SELECT COUNT(*) AS n FROM projects");
  return (row?.n ?? 0) > 0;
}
