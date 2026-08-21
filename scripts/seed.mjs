/**
 * Seeds the Project Starkvisionz database with a realistic three-project EPC portfolio.
 *
 * Everything is generated from a fixed PRNG seed, so re-running produces the
 * same portfolio. The earned-value figures are built so that the rolled-up
 * SPI/CPI land on the target performance defined per project — the dashboard
 * numbers are internally consistent rather than independently random.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { recalculateProject } from "../src/lib/rollup-core.mjs";

const ROOT = process.cwd();
const DB_PATH = process.env.STARKVISIONZ_DB_PATH
  ? path.resolve(process.env.STARKVISIONZ_DB_PATH)
  : path.join(ROOT, "data", "starkvisionz.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(fs.readFileSync(path.join(ROOT, "src", "lib", "schema.sql"), "utf8"));

// --------------------------------------------------------------------------
// Deterministic PRNG
// --------------------------------------------------------------------------
let _seed = 987654321;
const rnd = () => {
  _seed = (_seed * 1664525 + 1013904223) % 4294967296;
  return _seed / 4294967296;
};
const between = (a, b) => a + rnd() * (b - a);
const intBetween = (a, b) => Math.floor(between(a, b + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const jitter = (v, pct) => v * (1 + between(-pct, pct));

const DAY = 86_400_000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (isoDate, n) => iso(new Date(isoDate).getTime() + n * DAY);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);
const monthLabel = (isoDate) => isoDate.slice(0, 7);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v) => Math.round(v);

const DATA_DATE = "2026-07-31";

// --------------------------------------------------------------------------
// Portfolio definition
// --------------------------------------------------------------------------
const PROJECTS = [
  {
    id: "prj-gc4410",
    code: "GC-4410",
    name: "Gulf Coast LNG — Train 4 Expansion",
    client: "Sabine Midstream Partners",
    location: "Cameron Parish, LA",
    contract_type: "LSTK",
    phase: "Construction",
    status: "active",
    contract_value: 486_000_000,
    bac: 412_400_000,
    start_date: "2024-03-04",
    baseline_finish: "2027-06-30",
    forecast_finish: "2027-08-24",
    project_manager: "Dana Whitfield",
    controls_lead: "E. Stark",
    spi: 0.941,
    cpi: 0.968,
    description:
      "Lump-sum turnkey execution of a fourth 5.2 MTPA liquefaction train, including refrigerant compression, an additional 165,000 m³ LNG storage tank, and marine loading tie-ins to the existing Berth 2.",
    progress: {
      "Project Management": 0.72,
      Engineering: 0.97,
      Procurement: 0.86,
      Construction: 0.46,
      Commissioning: 0.02,
      Closeout: 0.0,
    },
  },
  {
    id: "prj-nv2208",
    code: "NV-2208",
    name: "Silver Basin Solar + Storage — 320 MWac",
    client: "Cascadia Renewable Power",
    location: "Churchill County, NV",
    contract_type: "EPCM",
    phase: "Construction",
    status: "active",
    contract_value: 268_000_000,
    bac: 241_500_000,
    start_date: "2025-01-13",
    baseline_finish: "2026-11-20",
    forecast_finish: "2026-11-06",
    project_manager: "Priya Raghunathan",
    controls_lead: "E. Stark",
    spi: 1.028,
    cpi: 1.011,
    description:
      "320 MWac single-axis-tracker PV field with a co-located 140 MW / 560 MWh lithium-iron-phosphate BESS, 230 kV collector substation, and a 6.4 km gen-tie to the Fallon switchyard.",
    progress: {
      "Project Management": 0.88,
      Engineering: 1.0,
      Procurement: 0.95,
      Construction: 0.8,
      Commissioning: 0.25,
      Closeout: 0.05,
    },
  },
  {
    id: "prj-ab1750",
    code: "AB-1750",
    name: "Scotford Blue Hydrogen — SMR Retrofit & CCS Tie-in",
    client: "Northgate Energy Ltd.",
    location: "Fort Saskatchewan, AB",
    contract_type: "Cost-Plus",
    phase: "Engineering",
    status: "active",
    contract_value: 158_000_000,
    bac: 143_900_000,
    start_date: "2026-01-06",
    baseline_finish: "2028-03-31",
    forecast_finish: "2028-05-15",
    project_manager: "Marcus Oyelaran",
    controls_lead: "E. Stark",
    spi: 0.972,
    cpi: 0.938,
    description:
      "Retrofit of two steam-methane reformers with autothermal pre-reforming, a 1.1 MTPA CO₂ capture island, and dehydration/compression tie-in to the regional sequestration trunkline.",
    progress: {
      "Project Management": 0.26,
      Engineering: 0.42,
      Procurement: 0.1,
      Construction: 0.0,
      Commissioning: 0.0,
      Closeout: 0.0,
    },
  },
];

/** Level-1 WBS with budget share and its level-2 children (share of the parent). */
const WBS_TEMPLATE = [
  {
    code: "1",
    name: "Project Management",
    category: "Project Management",
    share: 0.06,
    children: [
      { name: "Project Controls & Reporting", discipline: "Controls", share: 0.34 },
      { name: "Quality Assurance / Quality Control", discipline: "QA/QC", share: 0.28 },
      { name: "HSE Management", discipline: "HSE", share: 0.38 },
    ],
  },
  {
    code: "2",
    name: "Engineering",
    category: "Engineering",
    share: 0.14,
    children: [
      { name: "Process & Technology", discipline: "Process", share: 0.22 },
      { name: "Civil & Structural", discipline: "Civil", share: 0.16 },
      { name: "Mechanical & Rotating Equipment", discipline: "Mechanical", share: 0.19 },
      { name: "Electrical", discipline: "Electrical", share: 0.14 },
      { name: "Instrumentation & Controls", discipline: "I&C", share: 0.13 },
      { name: "Piping & Layout", discipline: "Piping", share: 0.16 },
    ],
  },
  {
    code: "3",
    name: "Procurement",
    category: "Procurement",
    share: 0.34,
    children: [
      { name: "Long-Lead Equipment", discipline: "Mechanical", share: 0.46 },
      { name: "Bulk Materials", discipline: "Piping", share: 0.24 },
      { name: "Subcontract Packages", discipline: "Construction", share: 0.2 },
      { name: "Logistics & Freight", discipline: "Logistics", share: 0.1 },
    ],
  },
  {
    code: "4",
    name: "Construction",
    category: "Construction",
    share: 0.38,
    children: [
      { name: "Site Preparation & Earthworks", discipline: "Civil", share: 0.09 },
      { name: "Foundations & Concrete", discipline: "Civil", share: 0.16 },
      { name: "Structural Steel Erection", discipline: "Structural", share: 0.14 },
      { name: "Mechanical Equipment Setting", discipline: "Mechanical", share: 0.21 },
      { name: "Piping Installation", discipline: "Piping", share: 0.24 },
      { name: "Electrical & Instrumentation Install", discipline: "Electrical", share: 0.16 },
    ],
  },
  {
    code: "5",
    name: "Commissioning & Start-up",
    category: "Commissioning",
    share: 0.05,
    children: [
      { name: "Pre-commissioning & Loop Checks", discipline: "I&C", share: 0.4 },
      { name: "Commissioning & First Fire", discipline: "Process", share: 0.38 },
      { name: "Performance Testing", discipline: "Process", share: 0.22 },
    ],
  },
  {
    code: "6",
    name: "Project Closeout",
    category: "Closeout",
    share: 0.03,
    children: [
      { name: "As-Built Documentation & Turnover", discipline: "Controls", share: 0.55 },
      { name: "Demobilisation & Final Accounts", discipline: "Controls", share: 0.45 },
    ],
  },
];

/** Activity names per level-2 WBS, keyed by the child name. */
const ACTIVITY_LIBRARY = {
  "Project Controls & Reporting": ["Baseline schedule development", "Monthly progress reporting cycle", "Change management administration", "Cost/schedule integration & EVM"],
  "Quality Assurance / Quality Control": ["Project quality plan issue", "Vendor surveillance programme", "Weld inspection & NDE campaign", "Turnover package QA review"],
  "HSE Management": ["Construction safety plan", "Site induction & training programme", "Permit-to-work system rollout", "Pre-startup safety review (PSSR)"],
  "Process & Technology": ["Heat & material balance revalidation", "PFD / P&ID development", "HAZOP & LOPA workshops", "Process datasheets issue for enquiry", "Operating philosophy & manuals"],
  "Civil & Structural": ["Geotechnical investigation report", "Pile design & foundation loading", "Structural steel design & modelling", "Civil IFC drawing release"],
  "Mechanical & Rotating Equipment": ["Compressor train specification", "Heat exchanger thermal design", "Vendor drawing review cycle", "Mechanical IFC package"],
  Electrical: ["Load list & single-line development", "Substation & switchgear design", "Cable schedule & routing", "Electrical IFC package"],
  "Instrumentation & Controls": ["Instrument index & datasheets", "DCS / SIS architecture design", "Control narrative development", "I&C IFC package"],
  "Piping & Layout": ["3D model reviews (30/60/90%)", "Stress analysis — critical lines", "Isometric extraction & release", "Piping MTO issue"],
  "Long-Lead Equipment": ["Refrigerant compressor package PO", "Main cryogenic heat exchanger PO", "Gas turbine driver PO", "Vendor expediting & inspection", "Equipment delivery to site"],
  "Bulk Materials": ["Pipe & fittings bulk award", "Cable & tray bulk award", "Structural steel mill order", "Bulk material receipt & warehousing"],
  "Subcontract Packages": ["Civil works subcontract award", "Mechanical erection subcontract award", "E&I subcontract award", "Insulation & painting award"],
  "Logistics & Freight": ["Heavy-lift transport study", "Ocean freight bookings", "Customs clearance & duties", "Site laydown management"],
  "Site Preparation & Earthworks": ["Site clearing & grubbing", "Bulk earthworks & grading", "Temporary facilities & site offices", "Underground utilities & drainage"],
  "Foundations & Concrete": ["Piling campaign", "Compressor foundation pours", "Storage tank ring beam", "Pipe rack foundations", "Substation foundations"],
  "Structural Steel Erection": ["Pipe rack steel erection", "Equipment support structures", "Access platforms & stairs", "Steel touch-up & fireproofing"],
  "Mechanical Equipment Setting": ["Compressor train setting & alignment", "Cold box installation", "Storage tank erection", "Exchanger & vessel setting", "Rotating equipment grouting"],
  "Piping Installation": ["Cryogenic piping spool erection", "Process piping erection", "Field welding & NDE", "Hydrotest & reinstatement", "Insulation application"],
  "Electrical & Instrumentation Install": ["Cable tray & conduit install", "Cable pulling & termination", "Instrument installation", "Loop checking preparation", "Substation energisation"],
  "Pre-commissioning & Loop Checks": ["System walkdowns & punchlisting", "Loop checks & functional tests", "Flushing & drying", "Nitrogen purge & leak test"],
  "Commissioning & First Fire": ["Utilities commissioning", "Refrigerant charging", "First feed gas introduction", "First LNG production"],
  "Performance Testing": ["Performance test run", "Reliability run (30 days)", "Provisional acceptance certificate"],
  "As-Built Documentation & Turnover": ["As-built drawing markup & issue", "Turnover package compilation", "Spare parts & vendor data handover"],
  "Demobilisation & Final Accounts": ["Site demobilisation", "Subcontract final accounts", "Project close-out report"],
};

const PEOPLE = [
  "D. Whitfield", "P. Raghunathan", "M. Oyelaran", "S. Alvarez", "T. Okonkwo",
  "R. Lindqvist", "H. Nakamura", "J. Boateng", "C. Duplessis", "L. Ferreira",
  "A. Kowalski", "N. Bhatt", "G. Mwangi", "K. O'Sullivan", "V. Petrov",
];

const VENDORS = [
  "Baker Turbomachinery", "Nordwind Fabricators", "Chart Cryogenic Systems",
  "Delta Steel Mills", "Siemens Energy", "ABB Process Automation",
  "Gulf Coast Industrial Services", "Vulcan Piping Contractors",
  "Meridian Logistics Group", "Cameron Civil Works", "Nexus Electrical Ltd.",
  "Trident Insulation Co.", "Apex NDE Services", "Harbourline Freight",
];

// --------------------------------------------------------------------------
// Prepared statements
// --------------------------------------------------------------------------
const insertProject = db.prepare(`
  INSERT INTO projects (id, code, name, client, location, contract_type, phase, status,
    currency, contract_value, budget_at_completion, start_date, baseline_finish,
    forecast_finish, data_date, project_manager, controls_lead, description)
  VALUES (@id, @code, @name, @client, @location, @contract_type, @phase, @status,
    'USD', @contract_value, @budget_at_completion, @start_date, @baseline_finish,
    @forecast_finish, @data_date, @project_manager, @controls_lead, @description)`);

const insertWbs = db.prepare(`
  INSERT INTO wbs_nodes (id, project_id, parent_id, code, name, level, sort_order,
    discipline, responsible, budget)
  VALUES (@id, @project_id, @parent_id, @code, @name, @level, @sort_order,
    @discipline, @responsible, @budget)`);

const insertTask = db.prepare(`
  INSERT INTO tasks (id, project_id, wbs_id, code, name, discipline, responsible, status,
    percent_complete, baseline_start, baseline_finish, actual_start, actual_finish,
    forecast_start, forecast_finish, duration_days, total_float_days, is_critical,
    is_milestone, budget, earned_value, actual_cost, predecessors, notes, sort_order)
  VALUES (@id, @project_id, @wbs_id, @code, @name, @discipline, @responsible, @status,
    @percent_complete, @baseline_start, @baseline_finish, @actual_start, @actual_finish,
    @forecast_start, @forecast_finish, @duration_days, @total_float_days, @is_critical,
    @is_milestone, @budget, @earned_value, @actual_cost, @predecessors, @notes, @sort_order)`);

const insertCostAccount = db.prepare(`
  INSERT INTO cost_accounts (id, project_id, wbs_id, code, name, category, cost_type,
    original_budget, approved_changes, current_budget, committed, actual_cost,
    earned_value, planned_value, forecast_at_completion)
  VALUES (@id, @project_id, @wbs_id, @code, @name, @category, @cost_type,
    @original_budget, @approved_changes, @current_budget, @committed, @actual_cost,
    @earned_value, @planned_value, @forecast_at_completion)`);

const insertCostEntry = db.prepare(`
  INSERT INTO cost_entries (id, project_id, cost_account_id, entry_date, entry_type,
    vendor, reference, description, amount, status)
  VALUES (@id, @project_id, @cost_account_id, @entry_date, @entry_type,
    @vendor, @reference, @description, @amount, @status)`);

const insertEvm = db.prepare(`
  INSERT INTO evm_periods (id, project_id, period_end, period_label, planned_value,
    earned_value, actual_cost, forecast_value, is_forecast)
  VALUES (@id, @project_id, @period_end, @period_label, @planned_value,
    @earned_value, @actual_cost, @forecast_value, @is_forecast)`);

const insertRisk = db.prepare(`
  INSERT INTO risks (id, project_id, wbs_id, code, title, description, category, risk_type,
    probability, impact, severity, status, owner, identified_date, review_date,
    cost_impact, schedule_impact_days, expected_value, response_strategy,
    mitigation_plan, mitigation_progress, residual_probability, residual_impact)
  VALUES (@id, @project_id, @wbs_id, @code, @title, @description, @category, @risk_type,
    @probability, @impact, @severity, @status, @owner, @identified_date, @review_date,
    @cost_impact, @schedule_impact_days, @expected_value, @response_strategy,
    @mitigation_plan, @mitigation_progress, @residual_probability, @residual_impact)`);

const insertDoc = db.prepare(`
  INSERT INTO documents (id, project_id, wbs_id, doc_number, title, doc_type, discipline,
    revision, status, review_status, originator, reviewer, issued_date, due_date,
    returned_date, transmittal_no, file_name, file_size_kb, format, notes)
  VALUES (@id, @project_id, @wbs_id, @doc_number, @title, @doc_type, @discipline,
    @revision, @status, @review_status, @originator, @reviewer, @issued_date, @due_date,
    @returned_date, @transmittal_no, @file_name, @file_size_kb, @format, @notes)`);

const insertChangeOrder = db.prepare(`
  INSERT INTO change_orders (id, project_id, code, title, origin, status, cost_impact,
    schedule_impact_days, raised_date, decision_date, description)
  VALUES (@id, @project_id, @code, @title, @origin, @status, @cost_impact,
    @schedule_impact_days, @raised_date, @decision_date, @description)`);

const insertConversation = db.prepare(`
  INSERT INTO conversations (id, project_id, title) VALUES (?, ?, ?)`);

const insertMessage = db.prepare(`
  INSERT INTO chat_messages (id, conversation_id, project_id, role, content, citations, created_at)
  VALUES (@id, @conversation_id, @project_id, @role, @content, @citations, @created_at)`);

// --------------------------------------------------------------------------
// Generation
// --------------------------------------------------------------------------

/**
 * Cumulative spend curve. `ss` is a smoothstep, raised to a power chosen so the
 * curve passes exactly through the project's planned progress at the data date.
 * That keeps the S-curve chart and the control-account roll-up telling the same
 * story instead of drifting apart.
 */
function makeCurve(timeFraction, plannedFraction) {
  const ss = (x) => x * x * (3 - 2 * x);
  const atData = ss(clamp(timeFraction, 0.02, 0.98));
  const target = clamp(plannedFraction, 0.01, 0.99);
  const power = Math.log(target) / Math.log(atData);
  return (x) => Math.pow(ss(clamp(x, 0, 1)), clamp(power, 0.4, 6));
}

const COST_TYPE_BY_CATEGORY = {
  "Project Management": "Labor",
  Engineering: "Labor",
  Procurement: "Material",
  Construction: "Subcontract",
  Commissioning: "Labor",
  Closeout: "Labor",
};

function seedProject(p) {
  const timeSpan = daysBetween(p.start_date, p.baseline_finish);
  const elapsed = daysBetween(p.start_date, DATA_DATE);
  const timeFraction = clamp(elapsed / timeSpan, 0.02, 0.98);

  insertProject.run({
    id: p.id,
    code: p.code,
    name: p.name,
    client: p.client,
    location: p.location,
    contract_type: p.contract_type,
    phase: p.phase,
    status: p.status,
    contract_value: p.contract_value,
    budget_at_completion: p.bac,
    start_date: p.start_date,
    baseline_finish: p.baseline_finish,
    forecast_finish: p.forecast_finish,
    data_date: DATA_DATE,
    project_manager: p.project_manager,
    controls_lead: p.controls_lead,
    description: p.description,
  });

  // ---- WBS -------------------------------------------------------------
  const level2 = [];
  let sort = 0;

  for (const l1 of WBS_TEMPLATE) {
    const l1Budget = p.bac * l1.share;
    const l1Id = `${p.id}-wbs-${l1.code}`;
    insertWbs.run({
      id: l1Id,
      project_id: p.id,
      parent_id: null,
      code: l1.code,
      name: l1.name,
      level: 1,
      sort_order: sort++,
      discipline: "",
      responsible: pick(PEOPLE),
      budget: round(l1Budget),
    });

    l1.children.forEach((child, i) => {
      const code = `${l1.code}.${i + 1}`;
      const id = `${p.id}-wbs-${code}`;
      const budget = round(l1Budget * child.share);
      insertWbs.run({
        id,
        project_id: p.id,
        parent_id: l1Id,
        code,
        name: child.name,
        level: 2,
        sort_order: sort++,
        discipline: child.discipline,
        responsible: pick(PEOPLE),
        budget,
      });
      level2.push({
        id,
        code,
        name: child.name,
        discipline: child.discipline,
        budget,
        category: l1.category,
        progress: p.progress[l1.category] ?? 0,
      });
    });
  }

  // ---- Cost accounts ---------------------------------------------------
  // Per-account performance wobbles around the project target so the variance
  // table has something to show. The wobble is applied first and normalised
  // afterwards: because CPI aggregates as a harmonic-style mean, averaging
  // jittered per-account indices lands measurably below the intended figure,
  // and the dashboard headline has to match the story the project is telling.
  const drafts = [];
  let accountNo = 1000;

  for (const node of level2) {
    const plannedPct = node.progress;
    const pv = node.budget * plannedPct;

    // Accounts that have not started carry no variance.
    const spiLocal = plannedPct <= 0 ? 1 : clamp(jitter(p.spi, 0.07), 0.7, 1.25);
    const cpiLocal = plannedPct <= 0 ? 1 : clamp(jitter(p.cpi, 0.06), 0.75, 1.2);

    accountNo += intBetween(10, 90);
    drafts.push({
      node,
      accountNo,
      pv,
      spiLocal,
      cpiLocal,
      approvedChanges: rnd() < 0.28 ? round(node.budget * between(-0.03, 0.09)) : 0,
      commitLead: node.category === "Procurement" ? between(1.1, 1.35) : between(0.98, 1.12),
    });
  }

  // Earned value and the forecast are NOT written here. They are derived from
  // activity progress by recalculateProject(), the same roll-up the API runs,
  // so the seeded database already satisfies the invariant that a schedule edit
  // must move the project's EVM. Budgets, planned value and the intended local
  // CPI are the inputs; the roll-up produces the rest.
  const accounts = [];
  for (const d of drafts) {
    const { node } = d;
    const currentBudget = round(node.budget + d.approvedChanges);

    const row = {
      id: `${p.id}-ca-${d.accountNo}`,
      project_id: p.id,
      wbs_id: node.id,
      code: `CA-${d.accountNo}`,
      name: node.name,
      category: node.category,
      cost_type: COST_TYPE_BY_CATEGORY[node.category] ?? "Other",
      original_budget: round(node.budget),
      approved_changes: d.approvedChanges,
      current_budget: currentBudget,
      committed: 0,
      actual_cost: 0,
      earned_value: 0,
      planned_value: round(d.pv),
      forecast_at_completion: currentBudget,
    };
    insertCostAccount.run(row);
    accounts.push({
      ...row,
      wbsCode: node.code,
      discipline: node.discipline,
      plannedPct: node.progress,
      // Carried so actual cost can be shaped to the intended performance once
      // earned value is known.
      cpiLocal: d.cpiLocal,
      commitLead: d.commitLead,
    });
  }

  // ---- Schedule activities --------------------------------------------
  // Each level-2 WBS gets a slice of the overall window sized to its phase, so
  // the Gantt reads front-to-back: engineering, procurement, then construction.
  const PHASE_WINDOW = {
    "Project Management": [0.0, 1.0],
    Engineering: [0.02, 0.46],
    Procurement: [0.16, 0.78],
    Construction: [0.34, 0.94],
    Commissioning: [0.86, 0.99],
    Closeout: [0.94, 1.0],
  };

  let taskNo = 1000;
  let taskSort = 0;
  const criticalChain = new Set();
  const tasks = [];

  for (const node of level2) {
    const names = ACTIVITY_LIBRARY[node.name] ?? [`${node.name} — execution`];
    const [winStart, winEnd] = PHASE_WINDOW[node.category] ?? [0, 1];
    const winDays = (winEnd - winStart) * timeSpan;
    const slice = winDays / names.length;

    names.forEach((activityName, i) => {
      taskNo += intBetween(5, 25);
      const code = `A${taskNo}`;
      const offset = winStart * timeSpan + i * slice;
      const duration = Math.max(5, round(slice * between(0.75, 1.25)));
      const baselineStart = addDays(p.start_date, round(offset));
      const baselineFinish = addDays(baselineStart, duration);

      // Progress is driven by where the activity sits relative to the data date.
      const bStart = daysBetween(p.start_date, baselineStart);
      const bFinish = daysBetween(p.start_date, baselineFinish);
      let pct;
      if (elapsed >= bFinish) pct = 100;
      else if (elapsed <= bStart) pct = 0;
      else pct = clamp(((elapsed - bStart) / (bFinish - bStart)) * 100 * p.spi, 0, 99);
      pct = round(pct);

      // Late activities drift; the drift grows the further right they sit.
      const drift =
        p.spi >= 1
          ? -intBetween(0, 6)
          : intBetween(0, Math.max(1, round((1 - p.spi) * duration * 2.2)));
      const forecastStart = addDays(baselineStart, pct > 0 ? Math.min(drift, 5) : drift);
      const forecastFinish = addDays(baselineFinish, drift);

      const complete = pct >= 100;
      const started = pct > 0;
      const blocked = !complete && started && rnd() < 0.05;
      const status = complete ? "complete" : blocked ? "blocked" : started ? "in-progress" : "not-started";

      const float = complete ? 0 : Math.max(0, round(between(0, 34) - drift));
      const isCritical = !complete && float <= 5;
      if (isCritical) criticalChain.add(code);

      const budget = round((node.budget / names.length) * between(0.85, 1.15));
      const ev = round(budget * (pct / 100));
      const localCpi = clamp(jitter(p.cpi, 0.08), 0.75, 1.2);
      const ac = ev > 0 ? round(ev / localCpi) : 0;

      const row = {
        id: `${p.id}-task-${code}`,
        project_id: p.id,
        wbs_id: node.id,
        code,
        name: activityName,
        discipline: node.discipline,
        responsible: pick(PEOPLE),
        status,
        percent_complete: pct,
        baseline_start: baselineStart,
        baseline_finish: baselineFinish,
        actual_start: started ? addDays(forecastStart, intBetween(-2, 3)) : null,
        actual_finish: complete ? forecastFinish : null,
        forecast_start: forecastStart,
        forecast_finish: forecastFinish,
        duration_days: duration,
        total_float_days: float,
        is_critical: isCritical ? 1 : 0,
        is_milestone: 0,
        budget,
        earned_value: ev,
        actual_cost: ac,
        predecessors: tasks.length > 0 && i > 0 ? tasks[tasks.length - 1].code : "",
        notes: blocked ? "Held pending vendor data / access — see risk register." : "",
        sort_order: taskSort++,
      };
      insertTask.run(row);
      tasks.push(row);
    });
  }

  // ---- Milestones ------------------------------------------------------
  // Milestones live in their own zero-budget branch so they read as project
  // markers rather than as work inside whichever package happened to be first.
  const milestoneWbsId = `${p.id}-wbs-0`;
  insertWbs.run({
    id: milestoneWbsId,
    project_id: p.id,
    parent_id: null,
    code: "0",
    name: "Project Milestones",
    level: 1,
    sort_order: -1,
    discipline: "Milestone",
    responsible: p.project_manager,
    budget: 0,
  });

  const MILESTONES = [
    ["Notice to Proceed", 0.0],
    ["Engineering 60% Model Review", 0.28],
    ["All Long-Lead POs Placed", 0.4],
    ["First Concrete", 0.42],
    ["Structural Steel Complete", 0.62],
    ["Mechanical Completion", 0.88],
    ["Ready for Start-up", 0.94],
    ["Substantial Completion", 1.0],
  ];

  MILESTONES.forEach(([name, at], i) => {
    const baselineDate = addDays(p.start_date, round(at * timeSpan));
    const slipDays = at * (daysBetween(p.baseline_finish, p.forecast_finish));
    const forecastDate = addDays(baselineDate, round(slipDays));
    const done = daysBetween(DATA_DATE, forecastDate) <= 0;
    taskNo += 7;
    insertTask.run({
      id: `${p.id}-ms-${i}`,
      project_id: p.id,
      wbs_id: milestoneWbsId,
      code: `M${1000 + i * 10}`,
      name,
      discipline: "Milestone",
      responsible: p.project_manager,
      status: done ? "complete" : "not-started",
      percent_complete: done ? 100 : 0,
      baseline_start: baselineDate,
      baseline_finish: baselineDate,
      actual_start: done ? forecastDate : null,
      actual_finish: done ? forecastDate : null,
      forecast_start: forecastDate,
      forecast_finish: forecastDate,
      duration_days: 0,
      total_float_days: 0,
      is_critical: 1,
      is_milestone: 1,
      budget: 0,
      earned_value: 0,
      actual_cost: 0,
      predecessors: "",
      notes: "",
      sort_order: -100 + i,
    });
  });

  // ---- Reconcile the money to the schedule ------------------------------
  // Earned value now comes only from activity progress, via the same roll-up
  // the API runs. To still land each project on its intended SPI and CPI, the
  // knobs are the inputs to that roll-up rather than its outputs: scale the
  // activity percents until the derived EV hits the target against PV, then
  // shape actual cost around the resulting EV.
  const projectPv = accounts.reduce((total, a) => total + a.planned_value, 0);

  const scaleTaskProgress = db.prepare(
    `UPDATE tasks
        SET percent_complete = MAX(0, MIN(100, percent_complete * ?)),
            earned_value = budget * (MAX(0, MIN(100, percent_complete * ?)) / 100.0)
      WHERE project_id = ? AND is_milestone = 0`
  );

  const currentEv = () =>
    db
      .prepare(`SELECT COALESCE(SUM(earned_value), 0) AS ev FROM cost_accounts WHERE project_id = ?`)
      .get(p.id).ev;

  // Clamping at 100% makes this non-linear, so iterate rather than solving once.
  recalculateProject(db, p.id);
  for (let pass = 0; pass < 12; pass++) {
    const ev = currentEv();
    if (ev <= 0) break;
    const k = (p.spi * projectPv) / ev;
    if (Math.abs(k - 1) < 0.0005) break;
    scaleTaskProgress.run(k, k, p.id);
    recalculateProject(db, p.id);
  }

  // Actual cost: give each account the performance it was drafted with, then
  // scale uniformly so the project CPI lands exactly on target. Scaling AC
  // cannot disturb the schedule-to-EV invariant, which is the point of keeping
  // the two directions separate.
  const evByAccount = new Map(
    db
      .prepare(`SELECT id, earned_value FROM cost_accounts WHERE project_id = ?`)
      .all(p.id)
      .map((row) => [row.id, row.earned_value])
  );

  let rawAcTotal = 0;
  for (const acc of accounts) {
    const ev = evByAccount.get(acc.id) ?? 0;
    acc.rawAc = ev > 0 ? ev / acc.cpiLocal : 0;
    rawAcTotal += acc.rawAc;
  }

  const projectEv = currentEv();
  const acScale = rawAcTotal > 0 ? projectEv / p.cpi / rawAcTotal : 1;

  const setActuals = db.prepare(
    `UPDATE cost_accounts SET actual_cost = ?, committed = ? WHERE id = ?`
  );
  for (const acc of accounts) {
    const ac = round(acc.rawAc * acScale);
    // Commitments run ahead of actuals on material-heavy accounts.
    const committed = Math.min(round(ac * acc.commitLead), round(acc.current_budget * 1.05));
    setActuals.run(ac, committed, acc.id);
    acc.actual_cost = ac;
    acc.committed = committed;
  }

  // Final pass: the forecast at completion depends on actual cost.
  recalculateProject(db, p.id);
  for (const row of db
    .prepare(`SELECT id, earned_value, forecast_at_completion FROM cost_accounts WHERE project_id = ?`)
    .all(p.id)) {
    const acc = accounts.find((a) => a.id === row.id);
    if (acc) {
      acc.earned_value = row.earned_value;
      acc.forecast_at_completion = row.forecast_at_completion;
    }
  }

  // ---- Cost ledger entries --------------------------------------------
  let entryNo = 0;
  for (const acc of accounts) {
    if (acc.actual_cost <= 0) continue;
    const count = intBetween(3, 7);
    let remaining = acc.actual_cost;
    for (let i = 0; i < count; i++) {
      const last = i === count - 1;
      const amount = last ? remaining : round(remaining * between(0.15, 0.45));
      remaining -= amount;
      if (amount <= 0) continue;

      const entryDate = addDays(p.start_date, intBetween(20, elapsed));
      const type = pick(["invoice", "invoice", "accrual", "timesheet", "commitment"]);
      entryNo += 1;
      insertCostEntry.run({
        id: `${p.id}-ce-${entryNo}`,
        project_id: p.id,
        cost_account_id: acc.id,
        entry_date: entryDate,
        entry_type: type,
        vendor: type === "timesheet" ? "Internal" : pick(VENDORS),
        reference:
          type === "invoice"
            ? `INV-${intBetween(10000, 99999)}`
            : type === "commitment"
              ? `PO-${intBetween(4000, 8999)}`
              : `JRN-${intBetween(1000, 9999)}`,
        description: `${acc.name} — ${type === "timesheet" ? "labour distribution" : "progress billing"}`,
        amount,
        status: rnd() < 0.07 ? "disputed" : rnd() < 0.15 ? "pending" : "posted",
      });
    }
  }


  // ---- Monthly EVM periods --------------------------------------------
  const totals = accounts.reduce(
    (acc, a) => ({
      pv: acc.pv + a.planned_value,
      ev: acc.ev + a.earned_value,
      ac: acc.ac + a.actual_cost,
      budget: acc.budget + a.current_budget,
      eac: acc.eac + a.forecast_at_completion,
    }),
    { pv: 0, ev: 0, ac: 0, budget: 0, eac: 0 }
  );

  const curve = makeCurve(timeFraction, totals.pv / totals.budget);
  const finalSpi = totals.ev / totals.pv;
  const finalCpi = totals.ev / totals.ac;

  const forecastSpan = daysBetween(p.start_date, p.forecast_finish);
  let cursor = new Date(`${p.start_date.slice(0, 7)}-01T00:00:00Z`);
  let period = 0;

  while (true) {
    // Month-end for the current cursor month.
    const end = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const endIso = iso(end);
    if (daysBetween(p.start_date, endIso) > forecastSpan + 31) break;

    const x = clamp(daysBetween(p.start_date, endIso) / timeSpan, 0, 1);
    const pvFrac = curve(x);
    const pv = round(totals.budget * pvFrac);

    const isForecast = endIso > DATA_DATE;
    // Performance degrades (or improves) gradually towards the current index.
    const ramp = clamp(daysBetween(p.start_date, endIso) / elapsed, 0, 1);
    const spiAt = 1 + (finalSpi - 1) * ramp;
    const cpiAt = 1 + (finalCpi - 1) * ramp;

    const ev = isForecast ? null : round(Math.min(pv * spiAt, totals.budget));
    const ac = isForecast ? null : round(ev > 0 ? ev / cpiAt : 0);

    // Forecast line: continues actual cost out to EAC along the remaining curve.
    let forecastValue = null;
    if (endIso >= DATA_DATE) {
      const xf = clamp(daysBetween(p.start_date, endIso) / forecastSpan, 0, 1);
      const remainFrac = clamp((curve(xf) - curve(timeFraction)) / (1 - curve(timeFraction)), 0, 1);
      forecastValue = round(totals.ac + (totals.eac - totals.ac) * remainFrac);
    }

    insertEvm.run({
      id: `${p.id}-evm-${period}`,
      project_id: p.id,
      period_end: endIso,
      period_label: monthLabel(endIso),
      planned_value: pv,
      earned_value: ev ?? 0,
      actual_cost: ac ?? 0,
      forecast_value: forecastValue,
      is_forecast: isForecast ? 1 : 0,
    });

    period += 1;
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    if (period > 120) break;
  }

  // The period rows exist now, so run the roll-up once more to stamp the
  // data-date period with the final totals. From here the seeded database
  // satisfies the same invariant the API maintains.
  recalculateProject(db, p.id);

  return { level2, accounts, tasks, totals, elapsed, timeSpan };
}

// --------------------------------------------------------------------------
// Risk register
// --------------------------------------------------------------------------
const RISK_LIBRARY = [
  {
    title: "Refrigerant compressor delivery slip",
    category: "Supply Chain",
    description: "Vendor has flagged a casting shortage at the sub-supplier affecting the propane compressor casing. Ex-works date at risk by 8–14 weeks.",
    mitigation: "Weekly expediting calls with the OEM; second-source the casting; resequence erection to take the compressor last.",
    strategy: "Mitigate",
  },
  {
    title: "Hurricane season site shutdown",
    category: "Schedule",
    description: "Gulf Coast named-storm activity historically costs 6–12 working days of site access between June and October.",
    mitigation: "Storm preparedness plan; secure laydown; build weather float into the Q3 look-ahead.",
    strategy: "Accept",
  },
  {
    title: "Craft labour availability shortfall",
    category: "Resource",
    description: "Two competing megaprojects within 90 miles are drawing pipefitters and welders; peak manning of 1,150 may not be achievable.",
    mitigation: "Early subcontractor commitments, per-diem uplift, and a travelling-craft agreement with the local.",
    strategy: "Mitigate",
  },
  {
    title: "Cryogenic pipe spool weld rejection rate",
    category: "Technical",
    description: "NDE reject rate on 9% nickel steel spools is running at 6.4% against a 2.5% allowance, driving rework hours.",
    mitigation: "Requalify welders on procedure WPS-N9-04; add automated orbital welding for the 12\" and above lines.",
    strategy: "Mitigate",
  },
  {
    title: "Client-driven scope growth on marine tie-ins",
    category: "Commercial",
    description: "Berth 2 loading arm interface has changed twice; further change is likely before IFC release.",
    mitigation: "Freeze the interface via a formal interface register; price all further change as a variation.",
    strategy: "Transfer",
  },
  {
    title: "Air permit amendment delay",
    category: "Regulatory",
    description: "State permit amendment for the additional flare load is with the regulator; approval is on the critical path to first fire.",
    mitigation: "Pre-submission meetings held; regulator liaison assigned; parallel-path the commissioning sequence.",
    strategy: "Mitigate",
  },
  {
    title: "Steel price escalation on remaining bulks",
    category: "Cost",
    description: "Roughly 22% of structural steel tonnage is unpriced and exposed to index movement through the next two quarters.",
    mitigation: "Convert remaining tonnage to a fixed-price mill order; hedge via the escalation clause in the subcontract.",
    strategy: "Transfer",
  },
  {
    title: "Vendor data late for I&C detailed design",
    category: "Schedule",
    description: "Certified vendor drawings for the package units are averaging 5 weeks late, holding loop drawings and cable schedules.",
    mitigation: "Escalation matrix with the OEMs; design with hold points and revise on receipt.",
    strategy: "Mitigate",
  },
  {
    title: "Subsurface conditions worse than geotech baseline",
    category: "Technical",
    description: "Two boreholes in the tank area returned lower blow counts than the baseline report, implying deeper piles.",
    mitigation: "Additional investigation ordered; pile design contingency held; differing-site-conditions claim prepared.",
    strategy: "Mitigate",
  },
  {
    title: "Lost-time incident during heavy lift campaign",
    category: "HSE",
    description: "Tandem lifts of the cold box and compressor modules represent the highest-consequence activity on the job.",
    mitigation: "Independent lift-plan review, exclusion zones, dedicated lift supervisor, and a stand-down before each critical lift.",
    strategy: "Mitigate",
  },
  {
    title: "Currency exposure on European equipment",
    category: "Commercial",
    description: "EUR-denominated equipment packages total roughly €18M with payment milestones through next year.",
    mitigation: "Forward-cover the milestone payments at award; review hedge coverage monthly with treasury.",
    strategy: "Transfer",
  },
  {
    title: "Commissioning spares not ordered in time",
    category: "Supply Chain",
    description: "Two-year operating spares have a 30-week lead time and have not yet been released for purchase.",
    mitigation: "Release the spares requisition ahead of mechanical completion; expedite via the OEM framework agreement.",
    strategy: "Mitigate",
  },
  {
    title: "Early completion incentive achievable",
    category: "Schedule",
    description: "Contract carries a $4.2M bonus for substantial completion 30 days ahead of the baseline date.",
    mitigation: "Compress the E&I install by adding a second shift once the pipe rack is released.",
    strategy: "Exploit",
    type: "opportunity",
  },
  {
    title: "Modularisation saving on pipe rack",
    category: "Cost",
    description: "Shop-fabricating four pipe-rack modules instead of stick-building could avoid roughly 9,000 site hours.",
    mitigation: "Run a constructability study with the fabricator; price the module option as a value-engineering change.",
    strategy: "Exploit",
    type: "opportunity",
  },
  {
    title: "Interface clash with operating Train 3",
    category: "Technical",
    description: "Tie-ins to the existing refrigerant header require a Train 3 outage that operations has not yet scheduled.",
    mitigation: "Joint outage planning workshop; prefabricate the tie-in spools to shorten the outage window.",
    strategy: "Mitigate",
  },
  {
    title: "Insulation subcontractor financial distress",
    category: "Commercial",
    description: "Credit report on the insulation subcontractor has been downgraded two notches since award.",
    mitigation: "Increase retention, obtain a parent-company guarantee, and pre-qualify a replacement contractor.",
    strategy: "Transfer",
  },
  {
    title: "DCS software licence and cyber compliance",
    category: "Regulatory",
    description: "Client's new OT cyber standard was issued after award and imposes additional segmentation requirements.",
    mitigation: "Gap assessment complete; price the delta as a variation; align with the client's OT security team.",
    strategy: "Mitigate",
  },
  {
    title: "Hydrotest water supply and disposal",
    category: "HSE",
    description: "Permitted discharge volume may be insufficient for the full hydrotest programme in the dry season.",
    mitigation: "Sequence tests to reuse water; secure a temporary discharge permit; provide on-site treatment.",
    strategy: "Mitigate",
  },
];

function seedRisks(p, level2, elapsed) {
  const count = p.code === "GC-4410" ? 18 : p.code === "NV-2208" ? 12 : 9;
  const pool = [...RISK_LIBRARY];

  for (let i = 0; i < count; i++) {
    const src = pool[i % pool.length];
    const isOpportunity = src.type === "opportunity";
    const probability = intBetween(isOpportunity ? 2 : 1, 5);
    const impact = intBetween(isOpportunity ? 2 : 1, 5);
    const severity = probability * impact;

    const status =
      severity >= 15
        ? pick(["open", "mitigating", "mitigating"])
        : pick(["open", "mitigating", "monitoring", "monitoring", "closed"]);

    const costImpact = round(p.bac * between(0.002, 0.028));
    const scheduleImpact = intBetween(0, 45);
    const identified = addDays(p.start_date, intBetween(10, Math.max(20, elapsed)));

    const mitigationProgress =
      status === "closed" ? 100 : status === "mitigating" ? intBetween(25, 85) : intBetween(0, 30);

    // Residual exposure after the mitigation plan has taken effect.
    const residualP = Math.max(1, probability - (mitigationProgress >= 50 ? 1 : 0));
    const residualI = Math.max(1, impact - (mitigationProgress >= 75 ? 1 : 0));

    insertRisk.run({
      id: `${p.id}-risk-${i + 1}`,
      project_id: p.id,
      wbs_id: pick(level2).id,
      code: `R-${String(i + 1).padStart(3, "0")}`,
      title: src.title,
      description: src.description,
      category: src.category,
      risk_type: isOpportunity ? "opportunity" : "threat",
      probability,
      impact,
      severity,
      status,
      owner: pick(PEOPLE),
      identified_date: identified,
      review_date: status === "closed" ? null : addDays(DATA_DATE, intBetween(5, 45)),
      cost_impact: costImpact,
      schedule_impact_days: scheduleImpact,
      expected_value: status === "closed" ? 0 : round(costImpact * (probability / 5)),
      response_strategy: src.strategy,
      mitigation_plan: src.mitigation,
      mitigation_progress: mitigationProgress,
      residual_probability: residualP,
      residual_impact: residualI,
    });
  }
}

// --------------------------------------------------------------------------
// Document control register
// --------------------------------------------------------------------------
const DOC_TEMPLATES = [
  ["Process Flow Diagram — Liquefaction Unit", "Drawing", "Process", "PR-PFD"],
  ["P&ID — Refrigerant Compression", "Drawing", "Process", "PR-PID"],
  ["P&ID — LNG Storage & Loading", "Drawing", "Process", "PR-PID"],
  ["Heat & Material Balance", "Calculation", "Process", "PR-CAL"],
  ["Process Design Basis", "Specification", "Process", "PR-SPC"],
  ["HAZOP Close-out Report", "Report", "Process", "PR-RPT"],
  ["Plot Plan — Overall Site", "Drawing", "Civil", "CV-DWG"],
  ["Geotechnical Investigation Report", "Report", "Civil", "CV-RPT"],
  ["Foundation Layout — Compressor Area", "Drawing", "Civil", "CV-DWG"],
  ["Pile Design Calculation", "Calculation", "Civil", "CV-CAL"],
  ["Concrete Works Specification", "Specification", "Civil", "CV-SPC"],
  ["Structural Steel General Arrangement", "Drawing", "Structural", "ST-DWG"],
  ["Pipe Rack Structural Design", "Calculation", "Structural", "ST-CAL"],
  ["Steel Fabrication Specification", "Specification", "Structural", "ST-SPC"],
  ["Equipment List", "Datasheet", "Mechanical", "ME-LST"],
  ["Compressor Package Datasheet", "Datasheet", "Mechanical", "ME-DTS"],
  ["Main Cryogenic Heat Exchanger Datasheet", "Datasheet", "Mechanical", "ME-DTS"],
  ["Mechanical Equipment Installation Procedure", "Procedure", "Mechanical", "ME-PRC"],
  ["Rotating Equipment Alignment Procedure", "Procedure", "Mechanical", "ME-PRC"],
  ["Vendor Data — Gas Turbine Driver", "Datasheet", "Mechanical", "ME-VDR"],
  ["Piping Material Specification", "Specification", "Piping", "PI-SPC"],
  ["Piping Isometrics — Unit 300", "Drawing", "Piping", "PI-ISO"],
  ["Stress Analysis — Cryogenic Lines", "Calculation", "Piping", "PI-CAL"],
  ["Piping MTO — Bulk Release 3", "Report", "Piping", "PI-MTO"],
  ["3D Model Review Report (60%)", "Report", "Piping", "PI-RPT"],
  ["Electrical Single Line Diagram", "Drawing", "Electrical", "EL-SLD"],
  ["Load List", "Datasheet", "Electrical", "EL-LST"],
  ["Cable Schedule", "Datasheet", "Electrical", "EL-LST"],
  ["Substation General Arrangement", "Drawing", "Electrical", "EL-DWG"],
  ["Hazardous Area Classification Drawing", "Drawing", "Electrical", "EL-DWG"],
  ["Earthing & Lightning Protection Design", "Calculation", "Electrical", "EL-CAL"],
  ["Instrument Index", "Datasheet", "I&C", "IC-LST"],
  ["Control System Architecture", "Drawing", "I&C", "IC-DWG"],
  ["Control Narrative — Liquefaction", "Specification", "I&C", "IC-SPC"],
  ["SIL Verification Report", "Report", "I&C", "IC-RPT"],
  ["Loop Diagrams — Package 4", "Drawing", "I&C", "IC-DWG"],
  ["Project Execution Plan", "Procedure", "Controls", "PM-PRC"],
  ["Project Quality Plan", "Procedure", "QA/QC", "QA-PRC"],
  ["Welding Procedure Specification WPS-N9-04", "Procedure", "QA/QC", "QA-PRC"],
  ["Inspection & Test Plan — Piping", "Procedure", "QA/QC", "QA-ITP"],
  ["Construction HSE Plan", "Procedure", "HSE", "HS-PRC"],
  ["Heavy Lift Plan — Cold Box", "Procedure", "HSE", "HS-PRC"],
  ["Pre-Commissioning Procedure", "Procedure", "Commissioning", "CM-PRC"],
  ["System Turnover Package Index", "Report", "Commissioning", "CM-RPT"],
  ["Material Test Certificates — Batch 12", "Certificate", "QA/QC", "QA-CRT"],
  ["Schedule Basis Memorandum", "Report", "Controls", "PM-RPT"],
];

const REVIEW_CODES = ["code-1", "code-2", "code-3"];

function seedDocuments(p, level2, elapsed) {
  const count = p.code === "GC-4410" ? DOC_TEMPLATES.length : p.code === "NV-2208" ? 30 : 20;
  const prefix = p.code.replace("-", "");

  for (let i = 0; i < count; i++) {
    const [title, docType, discipline, tag] = DOC_TEMPLATES[i % DOC_TEMPLATES.length];

    // Documents mature with the project: early projects hold more drafts. The
    // spread is deliberately wide so even a near-complete job keeps a tail of
    // late revisions rather than showing a register that is uniformly issued.
    const maturity = clamp(between(-0.35, 1) + (p.progress.Engineering ?? 0) - 0.5, 0, 1);
    const status =
      maturity > 0.86 ? "as-built"
      : maturity > 0.6 ? "ifc"
      : maturity > 0.38 ? "ifa"
      : maturity > 0.18 ? "ifr"
      : "draft";

    const revisionSeq = ["A", "B", "C", "0", "1", "2"];
    const revIndex = clamp(round(maturity * 5), 0, 5);
    const revision = revisionSeq[revIndex];

    let reviewStatus;
    if (status === "draft") reviewStatus = "not-started";
    else if (status === "as-built" || status === "ifc") reviewStatus = "approved";
    else reviewStatus = rnd() < 0.45 ? "in-review" : pick(REVIEW_CODES);

    // A document still awaiting a review decision must have been issued
    // recently — a register does not carry two-year-old open reviews. Resolved
    // documents can sit anywhere in the project's history.
    const unresolved = reviewStatus === "in-review" || reviewStatus === "code-3";
    const issued =
      status === "draft"
        ? null
        : unresolved
          ? addDays(DATA_DATE, -intBetween(6, 55))
          : addDays(p.start_date, intBetween(15, Math.max(25, elapsed - 30)));

    const due = issued ? addDays(issued, intBetween(10, 28)) : addDays(DATA_DATE, intBetween(5, 60));
    const returned = unresolved || reviewStatus === "not-started" ? null : addDays(due, intBetween(-6, 12));

    insertDoc.run({
      id: `${p.id}-doc-${i + 1}`,
      project_id: p.id,
      wbs_id: pick(level2).id,
      doc_number: `${prefix}-${tag}-${String(1000 + i * 7).padStart(4, "0")}`,
      title,
      doc_type: docType,
      discipline,
      revision,
      status,
      review_status: reviewStatus,
      originator: pick(PEOPLE),
      reviewer: reviewStatus === "not-started" ? "" : pick(PEOPLE),
      issued_date: issued,
      due_date: due,
      returned_date: returned,
      transmittal_no: issued ? `TR-${prefix}-${String(intBetween(100, 899))}` : "",
      file_name: `${prefix}-${tag}-${String(1000 + i * 7).padStart(4, "0")}_Rev${revision}.${docType === "Model" ? "nwd" : "pdf"}`,
      file_size_kb: intBetween(180, 24000),
      format: docType === "Model" ? "NWD" : "PDF",
      notes: reviewStatus === "code-3" ? "Returned for rework — comments to be incorporated in the next revision." : "",
    });
  }
}

// --------------------------------------------------------------------------
// Change orders / trends
// --------------------------------------------------------------------------
const CHANGE_LIBRARY = [
  ["Additional flare capacity for Train 4", "Client", "Client requested a larger flare tip to accommodate a future debottleneck."],
  ["Deeper piles — differing site conditions", "Site Condition", "Blow counts below the geotechnical baseline required 4 m of additional pile length in the tank area."],
  ["OT cyber security segmentation upgrade", "Client", "New client OT standard issued after award requires additional network segmentation and hardware."],
  ["Marine loading arm interface revision", "Client", "Second revision to the Berth 2 interface after the vendor selection changed."],
  ["Escalation on unpriced structural steel", "Internal", "Index movement on the remaining 22% of steel tonnage."],
  ["Pipe rack modularisation — value engineering", "Internal", "Shop fabrication of four modules in lieu of stick-build; net saving against the current estimate."],
  ["Extended winterisation for Q4 works", "Site Condition", "Additional temporary heating and hoarding to protect concrete pours."],
  ["Vendor rep support for extended commissioning", "Vendor", "Additional OEM field-service days beyond the contracted allowance."],
  ["Temporary power upgrade for construction", "Internal", "Peak construction load exceeded the temporary supply capacity."],
];

function seedChangeOrders(p, elapsed) {
  const count = p.code === "GC-4410" ? 9 : p.code === "NV-2208" ? 6 : 4;
  for (let i = 0; i < count; i++) {
    const [title, origin, description] = CHANGE_LIBRARY[i % CHANGE_LIBRARY.length];
    const status = pick(["trend", "submitted", "approved", "approved", "rejected"]);
    const isSaving = title.includes("value engineering");
    const raised = addDays(p.start_date, intBetween(30, Math.max(45, elapsed)));

    insertChangeOrder.run({
      id: `${p.id}-co-${i + 1}`,
      project_id: p.id,
      code: `CO-${String(i + 1).padStart(3, "0")}`,
      title,
      origin,
      status,
      cost_impact: round(p.bac * between(0.001, 0.014)) * (isSaving ? -1 : 1),
      schedule_impact_days: isSaving ? -intBetween(0, 10) : intBetween(0, 28),
      raised_date: raised,
      decision_date: status === "trend" || status === "submitted" ? null : addDays(raised, intBetween(14, 70)),
      description,
    });
  }
}

// --------------------------------------------------------------------------
// Seeded agent conversation — gives the chat panel something to open on
// --------------------------------------------------------------------------
function seedConversation(p, totals) {
  const convId = `conv-${p.id}`;
  insertConversation.run(convId, p.id, "Project controls review");

  if (p.code !== "GC-4410") return;

  const spi = totals.ev / totals.pv;
  const cpi = totals.ev / totals.ac;

  const messages = [
    {
      role: "user",
      content: "Give me the headline on where GC-4410 stands as of this data date.",
    },
    {
      role: "assistant",
      content: [
        `**GC-4410 — Gulf Coast LNG Train 4** as of ${DATA_DATE}.`,
        "",
        `The job is **behind schedule and slightly over cost**. SPI is ${spi.toFixed(3)} and CPI is ${cpi.toFixed(3)}, against a $${(totals.budget / 1e6).toFixed(1)}M current budget.`,
        "",
        "Three things are driving it:",
        "",
        "1. **Construction is the whole story.** Engineering and procurement are close to plan; the schedule variance is concentrated in piping installation and mechanical equipment setting.",
        "2. **Cost overrun is narrower than the schedule slip.** The CPI erosion is mostly rework hours on cryogenic spool welding, not a broad estimating miss.",
        "3. **The forecast finish sits past the baseline.** Recovering it means compressing the E&I install, which is the option carried in the schedule risk assessment.",
        "",
        "Ask me to break down the cost variance by control account, or to pull the critical path, and I'll go a level deeper.",
      ].join("\n"),
    },
  ];

  messages.forEach((m, i) => {
    insertMessage.run({
      id: `${convId}-msg-${i + 1}`,
      conversation_id: convId,
      project_id: p.id,
      role: m.role,
      content: m.content,
      citations: "",
      created_at: `2026-08-03 09:${String(12 + i * 3).padStart(2, "0")}:00`,
    });
  });
}

// --------------------------------------------------------------------------
// Run
// --------------------------------------------------------------------------
const wipe = db.transaction(() => {
  for (const table of [
    "chat_messages", "conversations", "change_orders", "documents", "risks",
    "evm_periods", "cost_entries", "cost_accounts", "tasks", "wbs_nodes", "projects",
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
});

/** Derives a stable stream seed from the project code. */
const seedFor = (code) =>
  [...code].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 4294967296, 7);

const build = db.transaction(() => {
  for (const p of PROJECTS) {
    // Reset per project: otherwise adding a risk to one project silently
    // shifts every figure in the next one.
    _seed = seedFor(p.code);
    const { level2, totals, elapsed } = seedProject(p);
    seedRisks(p, level2, elapsed);
    seedDocuments(p, level2, elapsed);
    seedChangeOrders(p, elapsed);
    seedConversation(p, totals);
  }
});

wipe();
build();

// --------------------------------------------------------------------------
// Report
// --------------------------------------------------------------------------
const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

console.log(`\n  Starkvisionz database seeded → ${DB_PATH}\n`);
console.log(`    projects       ${count("projects")}`);
console.log(`    wbs_nodes      ${count("wbs_nodes")}`);
console.log(`    tasks          ${count("tasks")}`);
console.log(`    cost_accounts  ${count("cost_accounts")}`);
console.log(`    cost_entries   ${count("cost_entries")}`);
console.log(`    evm_periods    ${count("evm_periods")}`);
console.log(`    risks          ${count("risks")}`);
console.log(`    documents      ${count("documents")}`);
console.log(`    change_orders  ${count("change_orders")}`);
console.log(`    chat_messages  ${count("chat_messages")}`);

console.log("\n  Performance roll-up:\n");
for (const row of db.prepare(`
  SELECT p.code, p.name,
         SUM(c.planned_value)  AS pv,
         SUM(c.earned_value)   AS ev,
         SUM(c.actual_cost)    AS ac,
         SUM(c.current_budget) AS bac
    FROM projects p JOIN cost_accounts c ON c.project_id = p.id
   GROUP BY p.id ORDER BY p.code`).all()) {
  const spi = (row.ev / row.pv).toFixed(3);
  const cpi = (row.ev / row.ac).toFixed(3);
  const pct = ((row.ev / row.bac) * 100).toFixed(1);
  console.log(
    `    ${row.code}  SPI ${spi}  CPI ${cpi}  ${pct.padStart(5)}% complete  BAC $${(row.bac / 1e6).toFixed(1)}M`
  );
}
console.log("");

db.close();
