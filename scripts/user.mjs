/**
 * Account administration from the command line.
 *
 * This is the bootstrap path: a fresh install has no accounts and no sign-up
 * page, so the first administrator is created here, by somebody who already has
 * access to the host. Everything it does is also available in the Users view
 * once an administrator exists — except creating that first one.
 *
 *   npm run user -- list
 *   npm run user -- add --email lead@example.com --name 'A Lead' --role admin
 *   npm run user -- passwd --email lead@example.com
 *   npm run user -- role --email lead@example.com --role planner
 *   npm run user -- scope --email lead@example.com --projects GC-4410,NV-2208:viewer
 *   npm run user -- scope --email lead@example.com --projects all
 *   npm run user -- disable --email lead@example.com
 *   npm run user -- enable  --email lead@example.com
 *   npm run user -- secret
 */
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { stdin, stdout } from "node:process";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { insertUser, normaliseEmail, updateUserRow } from "../src/lib/accounts-core.mjs";

const ROLES = ["viewer", "planner", "controls_lead", "admin"];
const PROJECT_ROLES = ROLES.filter((r) => r !== "admin");
const MIN_PASSWORD_CHARS = 12;

function dbFile() {
  const configured = process.env.STARKVISIONZ_DB_PATH;
  if (configured && configured.trim()) return path.resolve(configured.trim());
  return path.join(process.cwd(), "data", "starkvisionz.db");
}

function openDb() {
  const file = dbFile();
  if (!fs.existsSync(file)) {
    fail(`No database at ${file}. Run \`npm run db:seed\` first.`);
  }
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  return db;
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** `--key value` and bare `--flag`. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

/**
 * Reads a password without echoing it and without leaving it in shell history.
 * `--password` is accepted for scripted setup, and warned about.
 */
async function readPassword(supplied, prompt = "Password") {
  if (typeof supplied === "string") {
    console.warn("  note: a password passed as an argument is visible in your shell history.");
    return supplied;
  }

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });

  // readline echoes through the output stream, so the way to stop a password
  // appearing on screen is to write the prompt first and then swallow whatever
  // readline writes until the answer is in.
  const originalWrite = stdout.write;
  const ask = async (label) => {
    originalWrite.call(stdout, `${label}: `);
    stdout.write = () => true;
    try {
      return await rl.question("");
    } finally {
      stdout.write = originalWrite;
      originalWrite.call(stdout, "\n");
    }
  };

  const first = await ask(prompt);
  const second = await ask("Repeat");
  rl.close();

  if (first !== second) fail("Those did not match.");
  if (first.length < MIN_PASSWORD_CHARS) {
    fail(`A password must be at least ${MIN_PASSWORD_CHARS} characters.`);
  }
  return first;
}

/**
 * `--projects` accepts project codes, optionally with a role:
 *   GC-4410,NV-2208:viewer   scoped, viewer on the second
 *   all                      portfolio-wide at the account's own role
 */
function parseProjects(db, raw) {
  if (raw === undefined) return undefined;
  if (raw === true) fail("--projects needs a value: a list of codes, or 'all'.");
  if (String(raw).trim().toLowerCase() === "all") return [];

  return String(raw)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [code, role] = part.split(":").map((s) => s.trim());
      const project = db
        .prepare(`SELECT id, code FROM projects WHERE code = ? OR id = ?`)
        .get(code, code);
      if (!project) fail(`No project with code ${code}.`);
      if (role && !PROJECT_ROLES.includes(role)) {
        fail(`'${role}' cannot be granted on a single project. One of: ${PROJECT_ROLES.join(", ")}.`);
      }
      return { project_id: project.id, role: role ?? null };
    });
}

function requireUser(db, args) {
  const email = args.email;
  if (typeof email !== "string") fail("--email is required.");
  const row = db.prepare(`SELECT * FROM users WHERE email_key = ?`).get(normaliseEmail(email));
  if (!row) fail(`No account for ${email}.`);
  return row;
}

function describeScope(db, userId, role) {
  const grants = db
    .prepare(
      `SELECT p.code AS code, up.role AS role
         FROM user_projects up JOIN projects p ON p.id = up.project_id
        WHERE up.user_id = ? ORDER BY p.code`
    )
    .all(userId);
  if (grants.length === 0) return `all projects (${role})`;
  return grants.map((g) => `${g.code} (${g.role ?? role})`).join(", ");
}

// ---------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

if (command === "secret") {
  // No database needed: this is the signing key, printed for .env.local.
  console.log(`\nSTARKVISIONZ_SESSION_SECRET=${randomBytes(32).toString("hex")}\n`);
  process.exit(0);
}

if (!command || args.help) {
  console.log(
    [
      "",
      "Usage: npm run user -- <command> [options]",
      "",
      "  list                                  every account, role and project scope",
      "  add      --email --name --role        create an account (prompts for a password)",
      "  passwd   --email                      set a new password",
      "  role     --email --role               change the portfolio-wide role",
      "  scope    --email --projects           limit to projects, or 'all'",
      "  enable   --email                      restore access",
      "  disable  --email                      revoke access and end live sessions",
      "  secret                                print a STARKVISIONZ_SESSION_SECRET",
      "",
      `Roles: ${ROLES.join(", ")}`,
      "--projects takes codes, each optionally :role — e.g. GC-4410,NV-2208:viewer",
      "",
    ].join("\n")
  );
  process.exit(command ? 0 : 1);
}

const db = openDb();

switch (command) {
  case "list": {
    const rows = db.prepare(`SELECT * FROM users ORDER BY name COLLATE NOCASE`).all();
    if (rows.length === 0) {
      console.log("\nNo accounts yet. Create one with `npm run user -- add`.\n");
      break;
    }
    console.log("");
    for (const row of rows) {
      const state = row.is_active ? "" : "  [disabled]";
      const pending = row.must_change_password ? "  [must change password]" : "";
      console.log(`  ${row.name} <${row.email}>${state}${pending}`);
      console.log(`      ${row.role} · ${describeScope(db, row.id, row.role)}`);
      console.log(
        `      last signed in ${row.last_login_at ?? "never"} · created ${row.created_at}`
      );
    }
    console.log("");
    break;
  }

  case "add": {
    const { email, name, role } = args;
    if (typeof email !== "string") fail("--email is required.");
    if (typeof name !== "string") fail("--name is required.");
    if (!ROLES.includes(role)) fail(`--role must be one of: ${ROLES.join(", ")}.`);

    const projects = parseProjects(db, args.projects);
    const password = await readPassword(args.password, `Password for ${email}`);

    try {
      const id = insertUser(db, {
        email,
        name,
        password,
        role,
        projects,
        // Set by the person at the keyboard, so it is theirs to keep.
        mustChangePassword: false,
      });
      console.log(`\n  Created ${name} <${email}> as ${role}.`);
      console.log(`  Access: ${describeScope(db, id, role)}\n`);
    } catch (err) {
      fail(err.message);
    }
    break;
  }

  case "passwd": {
    const user = requireUser(db, args);
    const password = await readPassword(args.password, `New password for ${user.email}`);
    // Ends every session this account has open, here and elsewhere.
    updateUserRow(db, user.id, { password, mustChangePassword: false });
    console.log(`\n  Password changed for ${user.email}. Existing sessions have ended.\n`);
    break;
  }

  case "role": {
    const user = requireUser(db, args);
    if (!ROLES.includes(args.role)) fail(`--role must be one of: ${ROLES.join(", ")}.`);
    if (user.role === "admin" && args.role !== "admin") {
      const others = db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?`)
        .get(user.id).n;
      if (others === 0) fail("That is the last active administrator.");
    }
    updateUserRow(db, user.id, { role: args.role });
    console.log(`\n  ${user.email} is now ${args.role}. Existing sessions have ended.\n`);
    break;
  }

  case "scope": {
    const user = requireUser(db, args);
    const projects = parseProjects(db, args.projects);
    if (projects === undefined) fail("--projects is required: a list of codes, or 'all'.");
    updateUserRow(db, user.id, { projects });
    console.log(`\n  ${user.email} now has: ${describeScope(db, user.id, user.role)}\n`);
    break;
  }

  case "enable":
  case "disable": {
    const user = requireUser(db, args);
    const active = command === "enable";
    if (!active && user.role === "admin") {
      const others = db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?`)
        .get(user.id).n;
      if (others === 0) fail("That is the last active administrator.");
    }
    updateUserRow(db, user.id, { is_active: active });
    console.log(
      active
        ? `\n  ${user.email} can sign in again.\n`
        : `\n  ${user.email} is disabled and every session it had has ended.\n`
    );
    break;
  }

  default:
    fail(`Unknown command '${command}'. Run \`npm run user\` for usage.`);
}

db.close();
