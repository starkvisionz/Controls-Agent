import { z } from "zod";
import { PROJECT_ROLES, ROLES } from "@/lib/rbac";

/**
 * The write contract, shared by the UI and the API.
 *
 * The column allowlists in the routes stop a caller naming an arbitrary column;
 * these schemas stop a caller putting nonsense *into* an allowed one. A slider
 * that cannot produce 631% is not a guarantee — any HTTP client can, and a
 * controls database that accepts it reports fiction for the rest of the job.
 *
 * Every rule here is enforced server-side. The UI imports the same schemas so
 * the two cannot drift.
 */

/** Calendar date, `YYYY-MM-DD`, that is a real day rather than merely digits. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "not a real calendar date");

// Explicit messages: an API that answers "Invalid input" makes the caller guess
// which bound they crossed.
const percent = z
  .number({ message: "must be a number" })
  .finite("must be a finite number")
  .min(0, "cannot be below 0%")
  .max(100, "cannot exceed 100%");

const score = z
  .number({ message: "must be a number" })
  .int("must be a whole number")
  .min(1, "must be between 1 and 5")
  .max(5, "must be between 1 and 5");

const money = z
  .number({ message: "must be a number" })
  .finite("must be a finite number")
  .min(0, "cannot be negative")
  .max(1e12, "is implausibly large");

const days = (label: string) =>
  z
    .number({ message: "must be a number" })
    .int("must be a whole number of days")
    .min(-3650, `${label} must be within ten years`)
    .max(3650, `${label} must be within ten years`);

export const TASK_STATUSES = ["not-started", "in-progress", "complete", "blocked"] as const;
export const RISK_STATUSES = ["open", "mitigating", "monitoring", "closed", "realised"] as const;
export const RESPONSE_STRATEGIES = ["Avoid", "Transfer", "Mitigate", "Accept", "Exploit"] as const;
export const DOC_STATUSES = ["draft", "ifr", "ifa", "ifc", "as-built", "superseded"] as const;
export const REVIEW_STATUSES = [
  "not-started",
  "in-review",
  "code-1",
  "code-2",
  "code-3",
  "approved",
] as const;

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

export const taskPatchSchema = z
  .object({
    status: z.enum(TASK_STATUSES, { message: `must be one of: ${TASK_STATUSES.join(", ")}` }),
    percent_complete: percent,
    forecast_start: isoDate,
    forecast_finish: isoDate,
    responsible: z.string().trim().max(120),
    notes: z.string().max(2000),
    // Float is a signed number of days; negative float is a real and important
    // state (the activity is already past the date the network needs).
    total_float_days: days("float"),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "no editable fields supplied")
  .refine(
    (v) =>
      !(v.forecast_start && v.forecast_finish) || v.forecast_finish >= v.forecast_start,
    { message: "forecast finish cannot precede forecast start", path: ["forecast_finish"] }
  )
  // A completed activity at 40%, or a not-started one at 90%, would make the
  // schedule read one way and the earned value another.
  .refine((v) => !(v.status === "complete" && v.percent_complete !== undefined && v.percent_complete !== 100), {
    message: "a complete activity must be at 100%",
    path: ["percent_complete"],
  })
  .refine((v) => !(v.status === "not-started" && v.percent_complete !== undefined && v.percent_complete !== 0), {
    message: "a not-started activity must be at 0%",
    path: ["percent_complete"],
  });

export type TaskPatch = z.infer<typeof taskPatchSchema>;

// ---------------------------------------------------------------------------
// Risks
// ---------------------------------------------------------------------------

export const riskPatchSchema = z
  .object({
    status: z.enum(RISK_STATUSES, { message: `must be one of: ${RISK_STATUSES.join(", ")}` }),
    probability: score,
    impact: score,
    owner: z.string().trim().max(120),
    response_strategy: z.enum(RESPONSE_STRATEGIES, { message: `must be one of: ${RESPONSE_STRATEGIES.join(", ")}` }),
    mitigation_plan: z.string().max(4000),
    mitigation_progress: percent,
    cost_impact: money,
    schedule_impact_days: days("schedule impact"),
    review_date: isoDate.nullable(),
    residual_probability: score.nullable(),
    residual_impact: score.nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "no editable fields supplied");

export type RiskPatch = z.infer<typeof riskPatchSchema>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documentPatchSchema = z
  .object({
    status: z.enum(DOC_STATUSES, { message: `must be one of: ${DOC_STATUSES.join(", ")}` }),
    review_status: z.enum(REVIEW_STATUSES, { message: `must be one of: ${REVIEW_STATUSES.join(", ")}` }),
    revision: z.string().trim().min(1).max(8),
    reviewer: z.string().trim().max(120),
    due_date: isoDate.nullable(),
    issued_date: isoDate.nullable(),
    returned_date: isoDate.nullable(),
    notes: z.string().max(2000),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "no editable fields supplied");

export type DocumentPatch = z.infer<typeof documentPatchSchema>;

// ---------------------------------------------------------------------------
// Agent chat
// ---------------------------------------------------------------------------

/** Bounded so one caller cannot push an unbounded prompt into a paid model. */
export const MAX_MESSAGE_CHARS = 4000;

export const chatRequestSchema = z
  .object({
    projectId: z.string().trim().min(1).max(120),
    message: z
      .string()
      .trim()
      .min(1, "cannot be empty")
      .max(MAX_MESSAGE_CHARS, `cannot exceed ${MAX_MESSAGE_CHARS} characters`),
  })
  .strict();

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ---------------------------------------------------------------------------
// Change orders
// ---------------------------------------------------------------------------

export const CHANGE_STATUSES = ["trend", "submitted", "approved", "rejected"] as const;
export const CHANGE_ORIGINS = ["Client", "Internal", "Vendor", "Site Condition"] as const;

/** A decided order — approved or rejected — is one the client has ruled on. */
export const DECIDED_STATUSES = ["approved", "rejected"] as const;

/**
 * Cost impact is signed: a value-engineering order is a saving, so the money
 * bound here is symmetric rather than the non-negative `money` used for budgets.
 */
const changeValue = z
  .number({ message: "must be a number" })
  .finite("must be a finite number")
  .min(-1e11, "is implausibly large")
  .max(1e11, "is implausibly large");

const changeOrderFields = {
  cost_account_id: z.string().trim().min(1).max(120).nullish(),
  client_ref: z.string().trim().max(60).optional(),
  title: z.string().trim().min(1, "is required").max(160),
  origin: z.enum(CHANGE_ORIGINS, {
    message: `must be one of: ${CHANGE_ORIGINS.join(", ")}`,
  }),
  status: z.enum(CHANGE_STATUSES, {
    message: `must be one of: ${CHANGE_STATUSES.join(", ")}`,
  }),
  cost_impact: changeValue,
  schedule_impact_days: days("schedule impact"),
  raised_date: isoDate,
  submitted_date: isoDate.nullish(),
  decision_date: isoDate.nullish(),
  owner: z.string().trim().max(80).optional(),
  description: z.string().trim().max(2000).optional(),
};

export const changeOrderCreateSchema = z
  .object({
    ...changeOrderFields,
    // A new order starts open. Raising one straight into "approved" would skip
    // the record of it ever having been asked for.
    status: z.enum(["trend", "submitted"], { message: "a new order starts as trend or submitted" }),
    cost_impact: changeValue.optional(),
    schedule_impact_days: days("schedule impact").optional(),
    decision_date: z.null().optional(),
  })
  .strict();

export const changeOrderPatchSchema = z
  .object({
    cost_account_id: changeOrderFields.cost_account_id,
    client_ref: changeOrderFields.client_ref,
    title: changeOrderFields.title.optional(),
    origin: changeOrderFields.origin.optional(),
    status: changeOrderFields.status.optional(),
    cost_impact: changeValue.optional(),
    schedule_impact_days: days("schedule impact").optional(),
    submitted_date: changeOrderFields.submitted_date,
    decision_date: changeOrderFields.decision_date,
    owner: changeOrderFields.owner,
    description: changeOrderFields.description,
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "no changes supplied");

export type ChangeOrderCreate = z.infer<typeof changeOrderCreateSchema>;
export type ChangeOrderPatch = z.infer<typeof changeOrderPatchSchema>;

/**
 * The rules that need the stored row as well as the patch, so they cannot live
 * in the schema. Shared with the UI so the form refuses exactly what the route
 * would, rather than discovering it on submit.
 */
export function changeOrderRules(order: {
  status: string;
  cost_account_id: string | null;
  cost_impact: number;
  raised_date: string;
  submitted_date: string | null;
  decision_date: string | null;
}): FieldError[] {
  const errors: FieldError[] = [];
  const decided = (DECIDED_STATUSES as readonly string[]).includes(order.status);

  // Approving is the act that moves a budget, so it has to say which budget.
  if (order.status === "approved" && !order.cost_account_id) {
    errors.push({
      field: "cost_account_id",
      message: "is required before an order can be approved — it decides which budget moves",
    });
  }

  if (decided && !order.decision_date) {
    errors.push({ field: "decision_date", message: "is required once an order is decided" });
  }
  if (!decided && order.decision_date) {
    errors.push({
      field: "decision_date",
      message: "cannot be set while the order is still open",
    });
  }

  if (order.submitted_date && order.submitted_date < order.raised_date) {
    errors.push({ field: "submitted_date", message: "cannot precede the date it was raised" });
  }
  if (order.decision_date && order.decision_date < order.raised_date) {
    errors.push({ field: "decision_date", message: "cannot precede the date it was raised" });
  }
  if (order.decision_date && order.submitted_date && order.decision_date < order.submitted_date) {
    errors.push({ field: "decision_date", message: "cannot precede the date it was submitted" });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * Password floor.
 *
 * Length is the only rule. Composition rules ("one capital, one symbol") shrink
 * the search space people actually use and push them towards writing the result
 * down; a length floor does not.
 */
export const MIN_PASSWORD_CHARS = 12;
/** Bounds the work an attacker can make scrypt do on an unauthenticated route. */
export const MAX_PASSWORD_CHARS = 256;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_CHARS, `must be at least ${MIN_PASSWORD_CHARS} characters`)
  .max(MAX_PASSWORD_CHARS, `cannot exceed ${MAX_PASSWORD_CHARS} characters`);

export const emailSchema = z
  .string()
  .trim()
  .min(3, "is required")
  .max(254, "is too long")
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "must look like an email address");

export const roleSchema = z.enum(ROLES, { message: "is not a role" });

/**
 * One project grant. `role` may be omitted to mean "this account's global role
 * on this project"; `admin` is refused because account management cannot be
 * scoped to a single project.
 */
export const projectGrantSchema = z
  .object({
    project_id: z.string().trim().min(1).max(120),
    role: z.enum(PROJECT_ROLES, { message: "cannot be granted per project" }).nullish(),
  })
  .strict()
  .transform((g) => ({ project_id: g.project_id, role: g.role ?? null }));

/** An empty list is meaningful: portfolio-wide access at the account's role. */
export const projectGrantsSchema = z.array(projectGrantSchema).max(500);

export const loginSchema = z
  .object({
    email: emailSchema,
    // Not `passwordSchema`: an existing password predating a raised floor must
    // still be able to sign in, and telling an unauthenticated caller that
    // their guess was too short is a free hint.
    password: z.string().min(1, "is required").max(MAX_PASSWORD_CHARS),
  })
  .strict();

export const createUserSchema = z
  .object({
    email: emailSchema,
    name: z.string().trim().min(1, "is required").max(120),
    password: passwordSchema,
    role: roleSchema,
    projects: projectGrantsSchema.optional(),
  })
  .strict();

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1, "is required").max(120).optional(),
    role: roleSchema.optional(),
    is_active: z.boolean().optional(),
    password: passwordSchema.optional(),
    projects: projectGrantsSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "no changes supplied");

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "is required").max(MAX_PASSWORD_CHARS),
    new_password: passwordSchema,
  })
  .strict()
  .refine((b) => b.current_password !== b.new_password, {
    path: ["new_password"],
    message: "must differ from the current password",
  });

export type LoginRequest = z.infer<typeof loginSchema>;
export type CreateUserRequest = z.infer<typeof createUserSchema>;
export type UpdateUserRequest = z.infer<typeof updateUserSchema>;

// ---------------------------------------------------------------------------
// Shared failure shape
// ---------------------------------------------------------------------------

export type FieldError = { field: string; message: string };

/** Flattens a Zod failure into something a UI can show next to a field. */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.flatMap((issue) => {
    // An unknown key carries its names in the issue rather than the path, so
    // name them explicitly instead of reporting a bare "(request)".
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        field: key,
        message: "is not editable through this endpoint",
      }));
    }
    return [{ field: issue.path.join(".") || "(request)", message: issue.message }];
  });
}
