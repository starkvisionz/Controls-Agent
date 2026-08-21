/**
 * Roles and permissions.
 *
 * Deliberately free of `node:` and database imports: the same matrix decides
 * what the API allows and what the UI offers, and a client component has to be
 * able to ask. One table, two consumers — the alternative is a UI that hides a
 * button the API would have accepted, or offers one it would refuse.
 *
 * The roles are the ones an EPC controls team actually has. They are ordered:
 * each includes everything the one before it can do.
 */

export const ROLES = ["viewer", "planner", "controls_lead", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  /** See a project's registers at all. */
  "project:read",
  /** Ask the agent — it reads the whole project, so it is a read permission. */
  "agent:use",
  /** Activity progress, dates, status. */
  "schedule:write",
  /** Control accounts and the cost position. */
  "cost:write",
  /** The risk register and mitigation tracking. */
  "risk:write",
  /** The deliverable register. */
  "document:write",
  /** Create, amend and deactivate accounts. */
  "user:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = ["project:read", "agent:use"];
const PLANNER: Permission[] = [...VIEWER, "schedule:write", "document:write"];
const CONTROLS_LEAD: Permission[] = [...PLANNER, "cost:write", "risk:write"];
const ADMIN: Permission[] = [...CONTROLS_LEAD, "user:manage"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: VIEWER,
  planner: PLANNER,
  controls_lead: CONTROLS_LEAD,
  admin: ADMIN,
};

export const ROLE_LABELS: Record<Role, string> = {
  viewer: "Viewer",
  planner: "Planner",
  controls_lead: "Controls lead",
  admin: "Administrator",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: "Reads every register and can ask the agent. Changes nothing.",
  planner: "Viewer, plus activity progress, dates and the deliverable register.",
  controls_lead: "Planner, plus the cost position and the risk register.",
  admin: "Everything, including accounts and project access.",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Roles that may be granted on a single project.
 *
 * `admin` is missing on purpose. Account management is an instance-wide power
 * and cannot be scoped to one project, so allowing it as a per-project
 * override would silently promote the holder everywhere.
 */
export const PROJECT_ROLES = ROLES.filter((r) => r !== "admin");

export function roleGrants(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Which permission a write to a given register requires. */
export const WRITE_PERMISSION = {
  schedule: "schedule:write",
  cost: "cost:write",
  risk: "risk:write",
  document: "document:write",
} as const satisfies Record<string, Permission>;

// ---------------------------------------------------------------------------
// The resolved identity the rest of the app passes around
// ---------------------------------------------------------------------------

export type ProjectGrant = { project_id: string; role: Role | null };

export type Principal = {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Empty means the whole portfolio at the account's global role. */
  grants: ProjectGrant[];
  /** True when no credential is configured and the app is open for local development. */
  development: boolean;
};

/** The role this principal holds on one project, or null if it holds none. */
export function roleOnProject(principal: Principal, projectId: string): Role | null {
  if (principal.grants.length === 0) return principal.role;
  const grant = principal.grants.find((g) => g.project_id === projectId);
  if (!grant) return null;
  return grant.role ?? principal.role;
}

/**
 * The single authorisation question.
 *
 * Without a project, this asks whether the account could ever do this —
 * `user:manage` and the login-time checks. With one, it asks whether it may do
 * it *there*, which is the question every data route should be asking.
 */
export function can(principal: Principal, permission: Permission, projectId?: string): boolean {
  // Instance-wide powers are never granted by a per-project override.
  if (permission === "user:manage") return principal.role === "admin";

  if (projectId === undefined) return roleGrants(principal.role, permission);

  const role = roleOnProject(principal, projectId);
  return role !== null && roleGrants(role, permission);
}

/** Every permission this principal holds globally — what the UI is handed. */
export function permissionsOf(principal: Principal): Permission[] {
  return PERMISSIONS.filter((p) => can(principal, p));
}
