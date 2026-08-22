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
  migrate(db);
}

/**
 * Columns added to a table that already exists.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op against a database from an earlier
 * version, so a new column in schema.sql would never reach an existing install
 * — it would simply be missing, and every query naming it would throw. Each
 * entry here is checked against the live table and added only when absent, so
 * running this on a fresh database does nothing and running it twice is safe.
 *
 * Add-only. A column that needs renaming or retyping needs a real migration
 * with the data move written out, not a line here.
 */
const ADDED_COLUMNS: Record<string, Record<string, string>> = {
  change_orders: {
    cost_account_id: "TEXT REFERENCES cost_accounts(id) ON DELETE SET NULL",
    client_ref: "TEXT NOT NULL DEFAULT ''",
    submitted_date: "TEXT",
    owner: "TEXT NOT NULL DEFAULT ''",
    percent_complete: "REAL NOT NULL DEFAULT 0",
  },
  cost_accounts: {
    baseline_planned_value: "REAL NOT NULL DEFAULT 0",
  },
};

/**
 * Run once, immediately after the column it depends on is added.
 *
 * `ALTER TABLE ... ADD COLUMN` can only supply a constant default, so a column
 * that has to start out holding existing data needs a statement of its own.
 * Keyed by "table.column" and skipped entirely when that column was already
 * there, which is what keeps this idempotent.
 */
const BACKFILL: Record<string, string> = {
  // Before this column existed, `planned_value` held the baseline figure and
  // nothing else — there was no change component to separate out.
  "cost_accounts.baseline_planned_value":
    "UPDATE cost_accounts SET baseline_planned_value = planned_value",
};

export function migrate(db: Database.Database): void {
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
    );
    for (const [column, definition] of Object.entries(columns)) {
      if (existing.has(column)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);

      const backfill = BACKFILL[`${table}.${column}`];
      if (backfill) db.exec(backfill);
    }
  }
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
