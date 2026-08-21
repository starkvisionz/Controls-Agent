import type { Database } from "better-sqlite3";
import { all, getDb, one } from "@/lib/db";
// Plain JS so `scripts/user.mjs` and `scripts/seed.mjs` create accounts through
// the same code the app does. One definition of how a password is stored.
import {
  hashPassword as coreHash,
  insertUser,
  normaliseEmail as coreNormalise,
  replaceGrants as coreReplaceGrants,
  setOwnPassword as coreSetOwnPassword,
  updateUserRow,
  verifyPassword as coreVerify,
} from "@/lib/accounts-core.mjs";
import { isRole, type Principal, type ProjectGrant, type Role } from "@/lib/rbac";

/**
 * Local accounts.
 *
 * There is no identity provider to configure, so this table is the whole
 * answer to who may sign in. Credentials and the writes that touch them live in
 * `accounts-core.mjs`; everything here is the typed reading layer the app uses.
 *
 * There is no delete. Deactivating keeps the row, which keeps `last_login_at`
 * and the account's name attached to whatever it did — a controls system that
 * forgets who made a change is worth less than one that does not.
 */

export type UserRow = {
  id: string;
  email: string;
  email_key: string;
  name: string;
  password_hash: string;
  role: string;
  is_active: number;
  session_version: number;
  must_change_password: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

/** What the API hands back — never the digest. */
export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login_at: string | null;
  projects: ProjectGrant[];
};

export const hashPassword: (plain: string) => string = coreHash;
export const verifyPassword: (plain: string, digest: string | undefined) => boolean = coreVerify;
export const normaliseEmail: (email: string) => string = coreNormalise;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function findUserByEmail(email: string): UserRow | undefined {
  return one<UserRow>(`SELECT * FROM users WHERE email_key = ?`, [normaliseEmail(email)]);
}

export function findUserById(id: string): UserRow | undefined {
  return one<UserRow>(`SELECT * FROM users WHERE id = ?`, [id]);
}

export function grantsFor(userId: string): ProjectGrant[] {
  return all<{ project_id: string; role: string | null }>(
    `SELECT project_id, role FROM user_projects WHERE user_id = ? ORDER BY project_id`,
    [userId]
  ).map((g) => ({ project_id: g.project_id, role: isRole(g.role) ? g.role : null }));
}

export function countUsers(): number {
  return one<{ n: number }>(`SELECT COUNT(*) AS n FROM users`)?.n ?? 0;
}

/** Active administrators other than the one named — the last-admin check. */
export function countActiveAdmins(exceptUserId?: string): number {
  return (
    one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?`,
      [exceptUserId ?? ""]
    )?.n ?? 0
  );
}

export function listUsers(): PublicUser[] {
  return all<UserRow>(`SELECT * FROM users ORDER BY name COLLATE NOCASE`).map(toPublicUser);
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: isRole(row.role) ? row.role : "viewer",
    is_active: row.is_active === 1,
    must_change_password: row.must_change_password === 1,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    projects: grantsFor(row.id),
  };
}

/** The row as the rest of the app wants it: an authorisation subject. */
export function toPrincipal(row: UserRow): Principal {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    // An unrecognised role in the column falls to the least privilege rather
    // than throwing, so a hand-edited row cannot escalate.
    role: isRole(row.role) ? row.role : "viewer",
    grants: grantsFor(row.id),
    development: false,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type CreateUserInput = {
  email: string;
  name: string;
  password: string;
  role: Role;
  projects?: ProjectGrant[];
  mustChangePassword?: boolean;
};

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`An account already exists for ${email}`);
    this.name = "DuplicateEmailError";
  }
}

export function createUser(input: CreateUserInput, db: Database = getDb()): PublicUser {
  let id: string;
  try {
    id = insertUser(db, input) as string;
  } catch (err) {
    if ((err as { code?: string }).code === "DUPLICATE_EMAIL") {
      throw new DuplicateEmailError(input.email);
    }
    throw err;
  }
  return toPublicUser(findUserById(id)!);
}

export type UpdateUserInput = {
  name?: string;
  role?: Role;
  is_active?: boolean;
  password?: string;
  projects?: ProjectGrant[];
};

export function updateUser(id: string, patch: UpdateUserInput, db: Database = getDb()): PublicUser {
  updateUserRow(db, id, patch);
  return toPublicUser(findUserById(id)!);
}

export function replaceGrants(userId: string, grants: ProjectGrant[], db: Database = getDb()): void {
  coreReplaceGrants(db, userId, grants);
}

export function setOwnPassword(id: string, password: string, db: Database = getDb()): void {
  coreSetOwnPassword(db, id, password);
}

export function recordLogin(id: string, db: Database = getDb()): void {
  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(id);
}
