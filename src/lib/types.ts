export type Project = {
  id: string;
  code: string;
  name: string;
  client: string;
  location: string;
  contract_type: string;
  phase: string;
  status: string;
  currency: string;
  contract_value: number;
  budget_at_completion: number;
  start_date: string;
  baseline_finish: string;
  forecast_finish: string;
  data_date: string;
  project_manager: string;
  controls_lead: string;
  description: string;
};

export type WbsNode = {
  id: string;
  project_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  level: number;
  sort_order: number;
  discipline: string;
  responsible: string;
  budget: number;
};

export type Task = {
  id: string;
  project_id: string;
  wbs_id: string;
  code: string;
  name: string;
  discipline: string;
  responsible: string;
  status: "not-started" | "in-progress" | "complete" | "blocked";
  percent_complete: number;
  baseline_start: string;
  baseline_finish: string;
  actual_start: string | null;
  actual_finish: string | null;
  forecast_start: string;
  forecast_finish: string;
  duration_days: number;
  total_float_days: number;
  is_critical: number;
  is_milestone: number;
  budget: number;
  earned_value: number;
  actual_cost: number;
  predecessors: string;
  notes: string;
  sort_order: number;
};

export type CostAccount = {
  id: string;
  project_id: string;
  wbs_id: string | null;
  code: string;
  name: string;
  category: string;
  cost_type: string;
  original_budget: number;
  approved_changes: number;
  current_budget: number;
  committed: number;
  actual_cost: number;
  earned_value: number;
  planned_value: number;
  forecast_at_completion: number;
};

export type CostEntry = {
  id: string;
  project_id: string;
  cost_account_id: string;
  entry_date: string;
  entry_type: string;
  vendor: string;
  reference: string;
  description: string;
  amount: number;
  status: string;
};

export type EvmPeriod = {
  id: string;
  project_id: string;
  period_end: string;
  period_label: string;
  planned_value: number;
  earned_value: number;
  actual_cost: number;
  forecast_value: number | null;
  is_forecast: number;
};

export type Risk = {
  id: string;
  project_id: string;
  wbs_id: string | null;
  code: string;
  title: string;
  description: string;
  category: string;
  risk_type: "threat" | "opportunity";
  probability: number;
  impact: number;
  severity: number;
  status: string;
  owner: string;
  identified_date: string;
  review_date: string | null;
  cost_impact: number;
  schedule_impact_days: number;
  expected_value: number;
  response_strategy: string;
  mitigation_plan: string;
  mitigation_progress: number;
  residual_probability: number | null;
  residual_impact: number | null;
};

export type ProjectDocument = {
  id: string;
  project_id: string;
  wbs_id: string | null;
  doc_number: string;
  title: string;
  doc_type: string;
  discipline: string;
  revision: string;
  status: string;
  review_status: string;
  originator: string;
  reviewer: string;
  issued_date: string | null;
  due_date: string | null;
  returned_date: string | null;
  transmittal_no: string;
  file_name: string;
  file_size_kb: number;
  format: string;
  notes: string;
};

export type ChangeOrder = {
  id: string;
  project_id: string;
  /** The control account an approved order lands in. Null until it is priced. */
  cost_account_id: string | null;
  code: string;
  client_ref: string;
  title: string;
  origin: string;
  status: string;
  cost_impact: number;
  /** Progress on the change's own work. Only approved scope earns. */
  percent_complete: number;
  /** Recorded, and deliberately not applied to any forecast date. */
  schedule_impact_days: number;
  raised_date: string;
  submitted_date: string | null;
  decision_date: string | null;
  owner: string;
  description: string;
};

/** A register row with the account it is allocated to already resolved. */
export type ChangeOrderRow = ChangeOrder & {
  account_code: string | null;
  account_name: string | null;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  project_id: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  citations: string;
  created_at: string;
};

/** Derived earned-value metrics for a project at the data date. */
export type ProjectMetrics = {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  sv: number;
  cv: number;
  spi: number;
  cpi: number;
  eac: number;
  etc: number;
  vac: number;
  tcpi: number;
  percentComplete: number;
  percentSpent: number;
  committed: number;
  scheduleVarianceDays: number;
};

export type RiskSummary = {
  total: number;
  open: number;
  high: number;
  exposure: number;
  byCategory: { category: string; count: number; exposure: number }[];
};

export type DocumentSummary = {
  total: number;
  overdue: number;
  inReview: number;
  approved: number;
  byStatus: { status: string; count: number }[];
};
