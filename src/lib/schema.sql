-- ============================================================================
-- Project Starkvisionz — EPC Project Controls schema
-- SQLite. Money is stored in whole USD; durations in days; dates as ISO-8601.
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,       -- e.g. "GC-4410"
  name              TEXT NOT NULL,
  client            TEXT NOT NULL,
  location          TEXT NOT NULL,
  contract_type     TEXT NOT NULL,              -- LSTK | EPCM | Cost-Plus | Unit-Rate
  phase             TEXT NOT NULL,              -- FEED | Engineering | Procurement | Construction | Commissioning | Closeout
  status            TEXT NOT NULL,              -- active | on-hold | complete
  currency          TEXT NOT NULL DEFAULT 'USD',
  contract_value    REAL NOT NULL,              -- awarded contract value
  budget_at_completion REAL NOT NULL,           -- BAC
  start_date        TEXT NOT NULL,
  baseline_finish   TEXT NOT NULL,
  forecast_finish   TEXT NOT NULL,
  data_date         TEXT NOT NULL,              -- the "as of" date for all progress
  project_manager   TEXT NOT NULL,
  controls_lead     TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Work Breakdown Structure — self-referencing tree of deliverable-oriented nodes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wbs_nodes (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id         TEXT REFERENCES wbs_nodes(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,              -- e.g. "1.2.3"
  name              TEXT NOT NULL,
  level             INTEGER NOT NULL,           -- 1-based depth
  sort_order        INTEGER NOT NULL DEFAULT 0,
  discipline        TEXT NOT NULL DEFAULT '',   -- Civil | Mechanical | Electrical | Process | ...
  responsible       TEXT NOT NULL DEFAULT '',
  budget            REAL NOT NULL DEFAULT 0,
  UNIQUE (project_id, code)
);

CREATE INDEX IF NOT EXISTS idx_wbs_project ON wbs_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_wbs_parent  ON wbs_nodes(parent_id);

-- ---------------------------------------------------------------------------
-- Schedule activities (leaf work under the WBS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  wbs_id            TEXT NOT NULL REFERENCES wbs_nodes(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,              -- activity id, e.g. "A1230"
  name              TEXT NOT NULL,
  discipline        TEXT NOT NULL DEFAULT '',
  responsible       TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL,              -- not-started | in-progress | complete | blocked
  percent_complete  REAL NOT NULL DEFAULT 0,    -- 0..100
  baseline_start    TEXT NOT NULL,
  baseline_finish   TEXT NOT NULL,
  actual_start      TEXT,
  actual_finish     TEXT,
  forecast_start    TEXT NOT NULL,
  forecast_finish   TEXT NOT NULL,
  duration_days     INTEGER NOT NULL,
  total_float_days  INTEGER NOT NULL DEFAULT 0,
  is_critical       INTEGER NOT NULL DEFAULT 0, -- boolean
  is_milestone      INTEGER NOT NULL DEFAULT 0, -- boolean
  budget            REAL NOT NULL DEFAULT 0,
  earned_value      REAL NOT NULL DEFAULT 0,
  actual_cost       REAL NOT NULL DEFAULT 0,
  predecessors      TEXT NOT NULL DEFAULT '',   -- comma-separated task codes
  notes             TEXT NOT NULL DEFAULT '',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (project_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tasks_project  ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_wbs      ON tasks(wbs_id);
CREATE INDEX IF NOT EXISTS idx_tasks_critical ON tasks(project_id, is_critical);

-- ---------------------------------------------------------------------------
-- Cost accounts — the control-account level of the cost breakdown structure
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_accounts (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  wbs_id            TEXT REFERENCES wbs_nodes(id) ON DELETE SET NULL,
  code              TEXT NOT NULL,              -- e.g. "CA-3200"
  name              TEXT NOT NULL,
  category          TEXT NOT NULL,              -- Engineering | Procurement | Construction | Commissioning | Indirects | Contingency
  cost_type         TEXT NOT NULL,              -- Labor | Material | Equipment | Subcontract | Other
  original_budget   REAL NOT NULL DEFAULT 0,
  approved_changes  REAL NOT NULL DEFAULT 0,
  current_budget    REAL NOT NULL DEFAULT 0,    -- original + approved changes
  committed         REAL NOT NULL DEFAULT 0,    -- POs + subcontracts placed
  actual_cost       REAL NOT NULL DEFAULT 0,    -- ACWP
  -- Baseline and total are kept apart on both sides of the earned-value pair,
  -- the way original_budget and current_budget already are. Approved change
  -- scope earns on its own progress, not on the baseline scope's, so the two
  -- components have to stay separable.
  baseline_planned_value REAL NOT NULL DEFAULT 0, -- BCWS of the original scope
  baseline_earned_value  REAL NOT NULL DEFAULT 0, -- BCWP of the original scope
  earned_value      REAL NOT NULL DEFAULT 0,    -- BCWP, baseline + change scope
  planned_value     REAL NOT NULL DEFAULT 0,    -- BCWS, baseline + change scope
  forecast_at_completion REAL NOT NULL DEFAULT 0, -- EAC
  UNIQUE (project_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cost_accounts_project ON cost_accounts(project_id);

-- ---------------------------------------------------------------------------
-- Cost transactions — the ledger backing each control account
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_entries (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cost_account_id   TEXT NOT NULL REFERENCES cost_accounts(id) ON DELETE CASCADE,
  entry_date        TEXT NOT NULL,
  entry_type        TEXT NOT NULL,              -- commitment | invoice | accrual | timesheet | change-order
  vendor            TEXT NOT NULL DEFAULT '',
  reference         TEXT NOT NULL DEFAULT '',   -- PO / invoice number
  description       TEXT NOT NULL DEFAULT '',
  amount            REAL NOT NULL,
  status            TEXT NOT NULL DEFAULT 'posted' -- posted | pending | disputed
);

CREATE INDEX IF NOT EXISTS idx_cost_entries_project ON cost_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_cost_entries_account ON cost_entries(cost_account_id);

-- ---------------------------------------------------------------------------
-- Monthly EVM periods — drives the S-curve and SPI/CPI trend charts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evm_periods (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period_end        TEXT NOT NULL,              -- month-end date
  period_label      TEXT NOT NULL,              -- "2025-03"
  planned_value     REAL NOT NULL DEFAULT 0,    -- cumulative PV (BCWS)
  earned_value      REAL NOT NULL DEFAULT 0,    -- cumulative EV (BCWP)
  actual_cost       REAL NOT NULL DEFAULT 0,    -- cumulative AC (ACWP)
  forecast_value    REAL,                       -- cumulative forecast beyond data date
  is_forecast       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (project_id, period_label)
);

CREATE INDEX IF NOT EXISTS idx_evm_project ON evm_periods(project_id);

-- ---------------------------------------------------------------------------
-- Risk register
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risks (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  wbs_id            TEXT REFERENCES wbs_nodes(id) ON DELETE SET NULL,
  code              TEXT NOT NULL,              -- e.g. "R-014"
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL,              -- Schedule | Cost | Technical | Commercial | HSE | Regulatory | Supply Chain | Resource
  risk_type         TEXT NOT NULL DEFAULT 'threat', -- threat | opportunity
  probability       INTEGER NOT NULL,           -- 1..5
  impact            INTEGER NOT NULL,           -- 1..5
  severity          INTEGER NOT NULL,           -- probability * impact (1..25)
  status            TEXT NOT NULL,              -- open | mitigating | monitoring | closed | realised
  owner             TEXT NOT NULL,
  identified_date   TEXT NOT NULL,
  review_date       TEXT,
  cost_impact       REAL NOT NULL DEFAULT 0,    -- worst-case USD
  schedule_impact_days INTEGER NOT NULL DEFAULT 0,
  expected_value    REAL NOT NULL DEFAULT 0,    -- probability-weighted cost exposure
  response_strategy TEXT NOT NULL DEFAULT '',   -- Avoid | Transfer | Mitigate | Accept | Exploit
  mitigation_plan   TEXT NOT NULL DEFAULT '',
  mitigation_progress REAL NOT NULL DEFAULT 0,  -- 0..100
  residual_probability INTEGER,
  residual_impact   INTEGER,
  UNIQUE (project_id, code)
);

CREATE INDEX IF NOT EXISTS idx_risks_project  ON risks(project_id);
CREATE INDEX IF NOT EXISTS idx_risks_severity ON risks(project_id, severity DESC);

-- ---------------------------------------------------------------------------
-- Document control register
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  wbs_id            TEXT REFERENCES wbs_nodes(id) ON DELETE SET NULL,
  doc_number        TEXT NOT NULL,              -- e.g. "GC4410-ME-DWG-0021"
  title             TEXT NOT NULL,
  doc_type          TEXT NOT NULL,              -- Drawing | Specification | Datasheet | Report | Procedure | Calculation | Model | Certificate
  discipline        TEXT NOT NULL,
  revision          TEXT NOT NULL,              -- A, B, 0, 1 ...
  status            TEXT NOT NULL,              -- draft | ifr | ifa | ifc | as-built | superseded
  review_status     TEXT NOT NULL DEFAULT 'not-started', -- not-started | in-review | code-1 | code-2 | code-3 | approved
  originator        TEXT NOT NULL,
  reviewer          TEXT NOT NULL DEFAULT '',
  issued_date       TEXT,
  due_date          TEXT,
  returned_date     TEXT,
  transmittal_no    TEXT NOT NULL DEFAULT '',
  file_name         TEXT NOT NULL DEFAULT '',
  file_size_kb      INTEGER NOT NULL DEFAULT 0,
  format            TEXT NOT NULL DEFAULT 'PDF',
  notes             TEXT NOT NULL DEFAULT '',
  UNIQUE (project_id, doc_number, revision)
);

CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_status  ON documents(project_id, status);

-- ---------------------------------------------------------------------------
-- Change orders / trends
-- ---------------------------------------------------------------------------
-- A change order is money before it is a budget. `cost_account_id` is where an
-- approved one lands: `cost_accounts.approved_changes` is the SUM of approved
-- change orders allocated to that account, and nothing else may write it. That
-- is why approval requires an allocation — you cannot add to a budget without
-- saying which budget.
--
-- Schedule impact is recorded but deliberately NOT applied to the forecast
-- dates. Starkvisionz stores the network without solving it, so moving a finish
-- date on approval would assert an entitlement nobody calculated.
CREATE TABLE IF NOT EXISTS change_orders (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cost_account_id   TEXT REFERENCES cost_accounts(id) ON DELETE SET NULL,
  code              TEXT NOT NULL,              -- "CO-007"
  client_ref        TEXT NOT NULL DEFAULT '',   -- the client's own reference
  title             TEXT NOT NULL,
  origin            TEXT NOT NULL,              -- Client | Internal | Vendor | Site Condition
  status            TEXT NOT NULL,              -- trend | submitted | approved | rejected
  cost_impact       REAL NOT NULL DEFAULT 0,
  -- Progress on the change's own work. Approved scope enters the budget at
  -- once and is earned only as it is performed, so this starts at zero and an
  -- approval on its own moves no earned value.
  percent_complete  REAL NOT NULL DEFAULT 0,
  schedule_impact_days INTEGER NOT NULL DEFAULT 0,
  raised_date       TEXT NOT NULL,
  submitted_date    TEXT,                       -- with raised/decision, gives cycle time
  decision_date     TEXT,
  owner             TEXT NOT NULL DEFAULT '',   -- who is chasing it
  description       TEXT NOT NULL DEFAULT '',
  UNIQUE (project_id, code)
);

CREATE INDEX IF NOT EXISTS idx_change_orders_project ON change_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_account ON change_orders(cost_account_id);

-- ---------------------------------------------------------------------------
-- Agent conversations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id                TEXT PRIMARY KEY,
  project_id        TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title             TEXT NOT NULL DEFAULT 'New conversation',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id                TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  project_id        TEXT REFERENCES projects(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,              -- user | assistant | system
  content           TEXT NOT NULL,
  citations         TEXT NOT NULL DEFAULT '',   -- JSON array of {label, href}
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON chat_messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Accounts and access control
--
-- Local accounts: there is no identity provider to configure, so the users
-- table is the source of truth for who may sign in and what they may do.
--
-- `role` is the account's role across the portfolio. `user_projects` narrows
-- that: a user with no rows there sees every project at their global role,
-- and a user with rows sees only those projects — optionally at a different
-- role on each. That shape matches how controls staff actually sit on an EPC
-- portfolio, where a planner on one train is a reader on the next.
--
-- `session_version` is bumped whenever a credential or an authorisation
-- changes. Session cookies carry the version they were issued at, so a
-- deactivation, a role change or a password reset invalidates the sessions
-- already out there without a server-side session store.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  email_key         TEXT NOT NULL UNIQUE,       -- lower-cased, the uniqueness key
  name              TEXT NOT NULL,
  password_hash     TEXT NOT NULL,              -- scrypt$<saltHex>$<hashHex>
  role              TEXT NOT NULL,              -- viewer | planner | controls_lead | admin
  is_active         INTEGER NOT NULL DEFAULT 1,
  session_version   INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at     TEXT
);

CREATE TABLE IF NOT EXISTS user_projects (
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- NULL means "use the account's global role on this project".
  role              TEXT,
  PRIMARY KEY (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_user_projects_user ON user_projects(user_id);
