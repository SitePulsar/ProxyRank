import type { AgenticIntent } from "./types";

// ─── Scoring weights (locked rubric v1.0) ────────────────────────────────────

export const SCORING_WEIGHTS = {
  semantic: 35,
  schema: 30,
  reliability: 25,
  governance: 10,
} as const;

// Phase 1: live probe not run → max Reliability = 7/25
// Effective available points = 35 + 30 + 7 + 10 = 82 theoretical max,
// but practically 75 for a tool with no async flag and no structured output.
export const PHASE1_AVAILABLE_POINTS = 75;

// ─── Provisional thresholds ──────────────────────────────────────────────────
// PROVISIONAL: Calibrate at n=100 real audits. Do not treat as final.

/** Cosine similarity threshold for full intent alignment score (10 pts). */
export const PROVISIONAL_THRESHOLD_COSINE_SIMILARITY = 0.82;

/**
 * Per-tool average token threshold for penalty-free token efficiency.
 * Based on LangGraph's default 500ms tool timeout as an indirect proxy
 * for "how much context is cheap enough to always include."
 */
export const PROVISIONAL_THRESHOLD_MANIFEST_TOKENS_PER_TOOL = 200;
export const PROVISIONAL_THRESHOLD_MANIFEST_TOKENS_PER_TOOL_MEDIUM = 499;

/**
 * Extra token allowance per parameter beyond 4 for complex tools.
 * Prevents unfairly penalizing legitimately complex tools.
 */
export const EXTRA_TOKEN_ALLOWANCE_PER_PARAM = 100;

/** p95 latency threshold in ms — Phase 2 live probe feature. */
export const PROVISIONAL_THRESHOLD_LATENCY_MS = 450;

/** Minimum success rate for full reliability points — Phase 2. */
export const PROVISIONAL_THRESHOLD_SUCCESS_RATE = 0.96;

// ─── Selection Probability Lift ───────────────────────────────────────────────
// PROVISIONAL: Exponential curve. To be calibrated with real orchestrator data.
// Formula: Lift = exp((score - LIFT_BASELINE_SCORE) / LIFT_SCALE_FACTOR)
// Score 20 → 0.33×   Score 50 → 1.0× (baseline)
// Score 80 → 2.7×    Score 95 → 4.5×

export const LIFT_BASELINE_SCORE = 50;
export const LIFT_SCALE_FACTOR = 30;

// ─── 36 Agentic Intents (v1.1) ───────────────────────────────────────────────
// Source: Validated against real MCP registries, LangGraph/CrewAI patterns,
// and common orchestrator prompt analysis (March 2026).
// Expanding to 50 via registry crawls in v1.2.
//
// The `embedding` field is populated by running:
//   npm run precompute-intents
// and pasting the output back into this file.
// Until populated, semantic scoring falls back to keyword matching only.

export const AGENTIC_INTENTS: readonly AgenticIntent[] = [
  // Dev & Code (11)
  { label: "execute_code",      text: "Execute a code snippet and return its output" },
  { label: "generate_code",     text: "Generate code from a description or specification" },
  { label: "debug_error",       text: "Analyze an error and suggest or apply a fix" },
  { label: "refactor_code",     text: "Improve existing code structure without changing behavior" },
  { label: "test_function",     text: "Run tests against a function or module and report results" },
  { label: "deploy_service",    text: "Deploy an application or service to a cloud provider" },
  { label: "monitor_service",   text: "Check the health or status of a running service" },
  { label: "manage_git_repo",   text: "Create commits, branches, or pull requests in a git repository" },
  { label: "run_browser_action",text: "Control a browser to click, type, navigate, or scrape" },
  { label: "create_webhook",    text: "Register or manage a webhook endpoint for event notifications" },
  { label: "schedule_job",      text: "Schedule a recurring or delayed background job" },

  // Data & Query (7)
  { label: "query_database",    text: "Run a SQL or NoSQL query and return structured results" },
  { label: "write_database",    text: "Insert, update, or delete records in a database" },
  { label: "extract_entities",  text: "Extract named entities like people, places, or dates from text" },
  { label: "summarize_text",    text: "Summarize a long document or conversation into a shorter version" },
  { label: "classify_content",  text: "Classify or categorize text or data into predefined labels" },
  { label: "parse_document",    text: "Extract structured data from a PDF, spreadsheet, or document" },
  { label: "generate_report",   text: "Generate a formatted report or summary from structured data" },

  // Web & API (5)
  { label: "search_web",        text: "Search the web and return ranked relevant results" },
  { label: "fetch_web_content", text: "Retrieve and parse the content of a web page by URL" },
  { label: "call_api",          text: "Make an authenticated HTTP request to an external REST or GraphQL API" },
  { label: "get_stock_price",   text: "Fetch current or historical stock market prices and financial data" },
  { label: "get_weather",       text: "Retrieve current weather conditions or forecast for a location" },

  // Files & System (3)
  { label: "read_file",         text: "Read the contents of a file from disk or cloud storage" },
  { label: "write_file",        text: "Write or overwrite a file at a specified path" },
  { label: "list_files",        text: "List files and directories in a given path or storage bucket" },

  // Communication (4)
  { label: "send_email",        text: "Compose and send an email to one or more recipients" },
  { label: "read_email",        text: "Read, search, or parse emails from an inbox" },
  { label: "send_slack_message",text: "Send a message to a Slack channel or direct message" },
  { label: "manage_crm_contact",text: "Create, update, or retrieve a contact record in a CRM system" },

  // Workflow (6)
  { label: "translate_text",    text: "Translate text from one human language to another" },
  { label: "generate_image",    text: "Generate an image from a text prompt or description" },
  { label: "analyze_image",     text: "Analyze, describe, or extract information from an image" },
  { label: "transcribe_audio",  text: "Convert spoken audio or video to a text transcript" },
  { label: "search_knowledge_base", text: "Search an internal knowledge base, documentation, or vector store" },
  { label: "process_payment",   text: "Initiate, verify, or refund a payment transaction" },
] as const;

// Generic verbs that indicate a poorly-named tool (penalized in tool name scoring)
export const GENERIC_TOOL_VERBS = new Set([
  "get", "set", "do", "run", "call", "make", "use", "handle", "process",
  "execute", "perform", "action", "task", "helper", "util", "function",
]);

// High-intent imperative verbs that score well in description (Layer 1)
export const HIGH_INTENT_VERBS = new Set([
  "fetch", "create", "extract", "generate", "send", "monitor", "deploy",
  "classify", "summarize", "translate", "analyze", "transcribe", "search",
  "execute", "write", "read", "detect", "schedule", "register", "parse",
  "query", "convert", "upload", "download", "validate", "transform",
]);
