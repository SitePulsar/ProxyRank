// ─── MCP Manifest shapes ──────────────────────────────────────────────────────

export interface MCPToolParam {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  [key: string]: unknown;
}

export interface MCPTool {
  name: string;
  description?: string;
  parameters?: {
    type: "object";
    properties?: Record<string, MCPToolParam>;
    required?: string[];
  };
  output?: {
    type: string;
    description?: string;
    properties?: Record<string, MCPToolParam>;
  };
  async?: boolean;
  [key: string]: unknown;
}

export interface MCPManifest {
  schema_version?: string;
  name_for_human?: string;
  name_for_model?: string;
  description_for_human?: string;
  description_for_model?: string;
  tools: MCPTool[];
  signing?: {
    algorithm?: string;
    signature?: string;
    public_key_url?: string;
  };
  registries?: string[];
  domain_verification?: {
    verified: boolean;
    method?: string;
  };
  [key: string]: unknown;
}

export interface ParsedMCPServer {
  manifest: MCPManifest;
  primaryTool: MCPTool;
  totalTokens: number;
  avgTokensPerTool: number;
  fetchDurationMs: number;
  rawJson: string;
  sourceUrl: string;
}

// ─── Scoring shapes ───────────────────────────────────────────────────────────

export type AuditMode = "mcp" | "cli";

export interface LayerScores {
  semantic: number;    // 0–35
  schema: number;      // 0–30
  reliability: number; // 0–25
  governance: number;  // 0–10
}

export interface SemanticDetail {
  toolNameScore: number;         // 0–8
  descriptionScore: number;      // 0–12
  intentAlignmentScore: number;  // 0–10
  tokenEfficiencyScore: number;  // 0–5
  topMatchedIntents: string[];
  cosineSimilarity: number;
}

export interface SchemaDetail {
  paramTypesScore: number;        // 0–10
  paramDescriptionsScore: number; // 0–8
  requiredDefaultsScore: number;  // 0–5
  outputSchemaScore: number;      // 0–7
}

export interface ReliabilityDetail {
  latencyScore: number;       // 0–10 (always 0 in Phase 1)
  successRateScore: number;   // 0–8  (always 0 in Phase 1)
  responseTokensScore: number; // 0–4
  asyncSupportScore: number;   // 0–3
  liveProbeRun: false;         // always false in Phase 1
}

export interface GovernanceDetail {
  signatureScore: number; // 0–4
  registryScore: number;  // 0–3
  domainScore: number;    // 0–3
}

export interface LayerDetails {
  semantic: SemanticDetail;
  schema: SchemaDetail;
  reliability: ReliabilityDetail;
  governance: GovernanceDetail;
}

export interface AuditBreakdown {
  layers: LayerScores;
  details: LayerDetails;
  baseScore: number;
  finalScore: number;
  availablePoints: number; // 75 in Phase 1 (reliability probe not run)
  penaltyApplied: boolean;
  penaltyReason?: string;
  selectionLift: number;   // exp((score - 50) / 30) — PROVISIONAL
  totalManifestTokens: number;
  avgTokensPerTool: number;
  mode: AuditMode;
  toolCount: number;
  primaryToolName?: string;
  primaryToolDescription?: string;
  rawHelpText?: string; // CLI mode only
}

export interface AuditRecord {
  id: string;
  url: string;
  score: number;
  mode: AuditMode;
  breakdown: AuditBreakdown;
  user_id: string | null;
  created_at: string;
  is_gold_standard?: boolean;
  label?: string; // e.g. "Stripe MCP" for gold standards
}

// ─── API shapes ───────────────────────────────────────────────────────────────

export interface AuditRequest {
  url: string;
}

export interface AuditResponse {
  auditId: string;
  score: number;
  availablePoints: number;
}

export interface AuditError {
  error: string;
  code: "INVALID_URL" | "FETCH_FAILED" | "INVALID_JSON" | "INVALID_SCHEMA" | "TIMEOUT" | "INTERNAL" | "LOCALHOST_BLOCKED" | "AUTH_REQUIRED" | "HTML_RESPONSE" | "NOT_FOUND" | "STDIO_SERVER";
}

// ─── CLI Tool shapes ───────────────────────────────────────────────────────────

export interface CLIFlag {
  name: string;        // e.g. "--output"
  short?: string;      // e.g. "-o"
  description?: string;
  values?: string[];   // e.g. ["json", "text", "yaml"]
}

export interface ParsedCLITool {
  name: string;
  description: string;
  rawHelp: string;
  flags: CLIFlag[];
  subcommands: string[];
  hasJsonOutput: boolean;
  hasNonInteractiveMode: boolean;
  hasHelpFlag: boolean;
  totalTokens: number;
}

export interface CLISchemaDetail {
  jsonOutputScore: number;      // 0–10
  nonInteractiveScore: number;  // 0–8
  subcommandScore: number;      // 0–7
  helpFlagScore: number;        // 0–5
}

export interface CLIAuditBreakdown extends Omit<AuditBreakdown, "details"> {
  details: Omit<LayerDetails, "schema"> & { schema: CLISchemaDetail };
}

// ─── Semantic intent shape ────────────────────────────────────────────────────

export interface AgenticIntent {
  label: string;
  text: string;
  embedding?: number[]; // populated after precompute-intent-embeddings.ts is run
}
