/**
 * An empty database: the schema, and nothing in it.
 *
 * `db:seed` builds the demo portfolio — three fictional EPC projects and four
 * demo accounts — which is exactly wrong for a real deployment. This creates
 * the tables and stops, so `npm run user -- add` has somewhere to put the first
 * administrator and the registers start out as empty as the job does.
 *
 * Safe to run against a database that already exists: every statement in
 * schema.sql is CREATE ... IF NOT EXISTS, so this adds what is missing and
 * leaves what is there. It never drops or empties a table.
 *
 * Usage: node scripts/db-init.mjs
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

function dbFile() {
  const configured = process.env.STARKVISIONZ_DB_PATH;
  if (configured && configured.trim()) return path.resolve(configured.trim());
  return path.join(process.cwd(), "data", "starkvisionz.db");
}

const file = dbFile();
const existed = fs.existsSync(file);

fs.mkdirSync(path.dirname(file), { recursive: true });

const db = new Database(file);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));

const counts = {
  projects: db.prepare("SELECT count(*) AS n FROM projects").get().n,
  accounts: db.prepare("SELECT count(*) AS n FROM users").get().n,
};

db.close();

console.log(`\n  ${existed ? "Checked" : "Created"} ${file}`);
console.log(`  ${counts.projects} project(s), ${counts.accounts} account(s)\n`);

if (counts.accounts === 0) {
  console.log("  There is no way to sign in yet. Create the first administrator:\n");
  console.log("    npm run user -- add --email you@example.com --name 'Your Name' --role admin\n");
}
