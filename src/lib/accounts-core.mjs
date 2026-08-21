/**
 * Account credentials and writes, in plain JavaScript.
 *
 * The same reasoning as `rollup-core.mjs`: `scripts/user.mjs` and
 * `scripts/seed.mjs` create accounts without going through Next, so if the
 * hashing lived only in the TypeScript layer there would be two
 * implementations of how a password is stored — and the day they drift is the
 * day an account created by the CLI cannot sign in. One definition, three
 * callers.
 *
 * Storage format: `scrypt$<saltHex>$<hashHex>`, salted per account so two
 * people who choose the same password do not share a digest.
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_BYTES = 32;

export function hashPassword(plain) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(plain, salt, KEY_BYTES).toString("hex")}`;
}

/**
 * Constant-time check.
 *
 * A missing or malformed digest still runs a full scrypt comparison against
 * random bytes, so "no such account" costs what "wrong password" costs and the
 * login endpoint does not become a way to find out who has an account here.
 */
export function verifyPassword(plain, digest) {
  const [scheme, saltHex, hashHex] = String(digest ?? "").split("$");
  const usable = scheme === "scrypt" && Boolean(saltHex) && Boolean(hashHex);

  const salt = usable ? Buffer.from(saltHex, "hex") : randomBytes(16);
  const expected = usable ? Buffer.from(hashHex, "hex") : randomBytes(KEY_BYTES);
  const actual = scryptSync(plain, salt, expected.length || KEY_BYTES);

  const same = expected.length === actual.length && timingSafeEqual(expected, actual);
  return usable && same;
}

export function normaliseEmail(email) {
  return String(email).trim().toLowerCase();
}

export function newUserId() {
  return `usr-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Replaces a user's project scoping wholesale.
 *
 * An empty list is meaningful — it restores portfolio-wide access at the
 * account's global role — so this is a replace, never a merge.
 */
export function replaceGrants(db, userId, grants) {
  db.prepare(`DELETE FROM user_projects WHERE user_id = ?`).run(userId);
  const insert = db.prepare(`INSERT INTO user_projects (user_id, project_id, role) VALUES (?, ?, ?)`);
  for (const grant of grants ?? []) {
    // A grant naming a project that does not exist raises on the foreign key
    // rather than being dropped, so a typo is visible instead of silent.
    insert.run(userId, grant.project_id, grant.role ?? null);
  }
}

/** Inserts an account and its project grants in one transaction. */
export function insertUser(db, input) {
  const emailKey = normaliseEmail(input.email);
  const clash = db.prepare(`SELECT id FROM users WHERE email_key = ?`).get(emailKey);
  if (clash) {
    const error = new Error(`An account already exists for ${input.email}`);
    error.code = "DUPLICATE_EMAIL";
    throw error;
  }

  const id = input.id ?? newUserId();
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, email, email_key, name, password_hash, role, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      String(input.email).trim(),
      emailKey,
      String(input.name).trim(),
      hashPassword(input.password),
      input.role,
      input.mustChangePassword ? 1 : 0
    );
    replaceGrants(db, id, input.projects);
  });
  write();

  return id;
}

/**
 * Applies an administrative change.
 *
 * Anything altering what the account may do bumps `session_version`, which is
 * what makes a cookie already issued stop verifying. A cosmetic change — a
 * name — does not, so renaming somebody does not sign them out.
 */
export function updateUserRow(db, id, patch) {
  const existing = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  if (!existing) throw new Error(`No such account: ${id}`);

  const revokes =
    patch.password !== undefined ||
    (patch.role !== undefined && patch.role !== existing.role) ||
    (patch.is_active !== undefined && patch.is_active !== (existing.is_active === 1)) ||
    patch.projects !== undefined;

  const write = db.transaction(() => {
    const sets = [];
    const values = [];

    if (patch.name !== undefined) {
      sets.push("name = ?");
      values.push(String(patch.name).trim());
    }
    if (patch.role !== undefined) {
      sets.push("role = ?");
      values.push(patch.role);
    }
    if (patch.is_active !== undefined) {
      sets.push("is_active = ?");
      values.push(patch.is_active ? 1 : 0);
    }
    if (patch.password !== undefined) {
      // Somebody else chose it, so it is a starting credential rather than a
      // secret: the holder must replace it before the account is usable.
      sets.push("password_hash = ?", "must_change_password = ?");
      values.push(hashPassword(patch.password), patch.mustChangePassword === false ? 0 : 1);
    }
    if (revokes) sets.push("session_version = session_version + 1");
    sets.push("updated_at = datetime('now')");

    db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
    if (patch.projects !== undefined) replaceGrants(db, id, patch.projects);
  });
  write();
}

/** A person changing their own password: clears the forced-change flag. */
export function setOwnPassword(db, id, password) {
  db.prepare(
    `UPDATE users
        SET password_hash = ?,
            must_change_password = 0,
            session_version = session_version + 1,
            updated_at = datetime('now')
      WHERE id = ?`
  ).run(hashPassword(password), id);
}
