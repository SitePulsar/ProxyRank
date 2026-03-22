import type {
  ParsedMCPServer,
  AuditBreakdown,
  LayerScores,
  SemanticDetail,
  SchemaDetail,
  ReliabilityDetail,
  GovernanceDetail,
  ParsedCLITool,
  CLISchemaDetail,
  CLIAuditBreakdown,
} from "./types";
import {
  SCORING_WEIGHTS,
  PHASE1_AVAILABLE_POINTS,
  LIFT_BASELINE_SCORE,
  LIFT_SCALE_FACTOR,
  PROVISIONAL_THRESHOLD_MANIFEST_TOKENS_PER_TOOL,
  PROVISIONAL_THRESHOLD_MANIFEST_TOKENS_PER_TOOL_MEDIUM,
  EXTRA_TOKEN_ALLOWANCE_PER_PARAM,
  HIGH_INTENT_VERBS,
  GENERIC_TOOL_VERBS,
} from "./constants";
import type { scoreIntentAlignment } from "./semantic";

type IntentResult = Awaited<ReturnType<typeof scoreIntentAlignment>>;

// ─── Layer 1: Semantic Discovery (max 35 pts) ─────────────────────────────────

/** Tool name quality (0–8 pts). */
export function scoreToolName(name: string): number {
  if (!name) return 0;
  let pts = 0;

  const parts = name.split("_");
  const firstWord = parts[0].toLowerCase();

  // First word is an action verb
  if (firstWord && !GENERIC_TOOL_VERBS.has(firstWord)) pts += 3;

  // Snake_case compound noun (at least 2 parts)
  if (parts.length >= 2) pts += 2;

  // Length 15–50 chars (specific enough, not too verbose)
  if (name.length >= 15 && name.length <= 50) pts += 2;

  // No red-flag words
  if (!/(test|temp|demo|foo|bar|example|sample)/i.test(name)) pts += 1;

  return Math.min(pts, 8);
}

/** Description quality (0–12 pts). */
export function scoreDescription(description: string | undefined): number {
  if (!description || description.trim().length < 10) return 0;

  let pts = 0;
  const desc = description.trim();

  // Starts with a high-intent imperative verb
  const firstWord = desc.split(/\s/)[0].replace(/[^a-zA-Z]/g, "").toLowerCase();
  if (HIGH_INTENT_VERBS.has(firstWord)) pts += 4;

  // Sentence count 1–2
  const sentenceCount = (desc.match(/[.!?]/g) ?? []).length;
  if (sentenceCount >= 1 && sentenceCount <= 2) pts += 3;

  // Length 50–250 chars (concise but informative)
  if (desc.length >= 50 && desc.length <= 250) pts += 3;

  // Mentions format, constraint, or output type
  if (/\b(return|output|format|json|string|list|array|object|number)\b/i.test(desc)) pts += 2;

  return Math.min(pts, 12);
}

/** Token efficiency (0–5 pts). Per-tool average with param-count allowance. */
export function scoreTokenEfficiency(
  avgTokensPerTool: number,
  paramCount: number
): number {
  // Complex tools (>4 params) get extra allowance
  const extraAllowance = Math.max(0, paramCount - 4) * EXTRA_TOKEN_ALLOWANCE_PER_PARAM;
  const adjustedAvg = avgTokensPerTool - extraAllowance;

  if (adjustedAvg < PROVISIONAL_THRESHOLD_MANIFEST_TOKENS_PER_TOOL) return 5; // < 200
  if (adjustedAvg <= PROVISIONAL_THRESHOLD_MANIFEST_TOKENS_PER_TOOL_MEDIUM) return 3; // 200–499
  return 0; // ≥ 500
}

export function scoreSemanticLayer(
  server: ParsedMCPServer,
  intentResult: IntentResult
): { points: number; detail: SemanticDetail } {
  const { primaryTool, avgTokensPerTool } = server;
  const paramCount = Object.keys(
    primaryTool.parameters?.properties ?? {}
  ).length;

  const toolNameScore = scoreToolName(primaryTool.name);
  const descriptionScore = scoreDescription(primaryTool.description);
  const intentAlignmentScore = intentResult.score;
  const tokenEfficiencyScore = scoreTokenEfficiency(avgTokensPerTool, paramCount);

  return {
    points: toolNameScore + descriptionScore + intentAlignmentScore + tokenEfficiencyScore,
    detail: {
      toolNameScore,
      descriptionScore,
      intentAlignmentScore,
      tokenEfficiencyScore,
      topMatchedIntents: intentResult.topIntents,
      cosineSimilarity: intentResult.topSimilarity,
    },
  };
}

// ─── Layer 2: Schema & Interface Hygiene (max 30 pts, MCP mode) ───────────────

export function scoreSchemaLayer(server: ParsedMCPServer): {
  points: number;
  detail: SchemaDetail;
} {
  const { primaryTool } = server;
  const props = primaryTool.parameters?.properties ?? {};
  const required = primaryTool.parameters?.required ?? [];
  const totalParams = Object.keys(props).length;

  // Param strict types (0–10)
  let paramTypesScore = 5; // benefit of the doubt for zero-param tools
  if (totalParams > 0) {
    const strictTypes = new Set(["string", "number", "integer", "boolean", "array"]);
    const passing = Object.values(props).filter(
      (p) => strictTypes.has(p.type) || (p.enum && p.enum.length > 0)
    ).length;
    paramTypesScore = Math.round((passing / totalParams) * 10);
  }

  // Param descriptions ≥ 15 chars (0–8)
  let paramDescriptionsScore = 0;
  if (totalParams > 0) {
    const described = Object.values(props).filter(
      (p) => typeof p.description === "string" && p.description.trim().length >= 15
    ).length;
    paramDescriptionsScore = Math.round((described / totalParams) * 8);
  }

  // Required array + optional params have defaults (0–5)
  let requiredDefaultsScore = 0;
  if (required.length > 0) {
    requiredDefaultsScore += 2;
    // Optional params (not in required) have defaults
    const optionalParams = Object.entries(props).filter(
      ([k]) => !required.includes(k)
    );
    if (optionalParams.length === 0 || optionalParams.every(([, v]) => v.default !== undefined)) {
      requiredDefaultsScore += 3;
    } else {
      requiredDefaultsScore += 1;
    }
  }

  // Output schema (0–7)
  const output = primaryTool.output;
  let outputSchemaScore = 0;
  if (output) {
    if (output.type) outputSchemaScore += 3;
    if (output.properties && Object.keys(output.properties).length > 0) outputSchemaScore += 2;
    if (output.description && output.description.trim().length > 5) outputSchemaScore += 2;
  }

  return {
    points: paramTypesScore + paramDescriptionsScore + requiredDefaultsScore + outputSchemaScore,
    detail: {
      paramTypesScore,
      paramDescriptionsScore,
      requiredDefaultsScore,
      outputSchemaScore,
    },
  };
}

// ─── Layer 3: Reliability & Performance (max 25 pts) ─────────────────────────
// Phase 1: live probe skipped. Max achievable = 7/25.

export function scoreReliabilityLayer(server: ParsedMCPServer): {
  points: number;
  detail: ReliabilityDetail;
} {
  const { primaryTool } = server;

  // Latency (0–10): always 0 in Phase 1
  const latencyScore = 0;

  // Success rate (0–8): always 0 in Phase 1
  const successRateScore = 0;

  // Response tokens (0–4): infer from output schema presence
  const output = primaryTool.output;
  const responseTokensScore =
    output && (output.type === "object" || output.type === "string") ? 4 : 0;

  // Async support (0–3)
  const asyncSupportScore = primaryTool.async === true ? 3 : 0;

  return {
    points: latencyScore + successRateScore + responseTokensScore + asyncSupportScore,
    detail: {
      latencyScore,
      successRateScore,
      responseTokensScore,
      asyncSupportScore,
      liveProbeRun: false,
    },
  };
}

// ─── Layer 4: Governance & Authority (max 10 pts) ────────────────────────────

export function scoreGovernanceLayer(server: ParsedMCPServer): {
  points: number;
  detail: GovernanceDetail;
} {
  const { manifest } = server;

  // Signed manifest (0–4)
  const signing = manifest.signing;
  let signatureScore = 0;
  if (signing?.signature) signatureScore += 2;
  if (signing?.public_key_url) signatureScore += 2;

  // Registry listing (0–3)
  const registries = manifest.registries ?? [];
  const registryScore =
    registries.length >= 2 ? 3 : registries.length === 1 ? 1 : 0;

  // Domain verified (0–3)
  const domainScore =
    manifest.domain_verification?.verified === true ? 3 : 0;

  return {
    points: signatureScore + registryScore + domainScore,
    detail: { signatureScore, registryScore, domainScore },
  };
}

// ─── Penalty rule ─────────────────────────────────────────────────────────────

/**
 * Applies the minimum-category penalty rule.
 *
 * m = lowest category fraction (actual / max), excluding Phase 1 known-zeros:
 *   - Reliability is always 0 in Phase 1 (no live probe) — excluded from penalty
 *   - Governance is excluded for CLI audits (no manifest signing/registry metadata)
 *
 * m < 0.30 → final = min(base, 20)  "Likely Invisible"
 * m < 0.50 → final = round(base × 0.45)  heavy penalty
 * else     → final = base
 */
export function applyPenaltyRule(
  baseScore: number,
  layers: LayerScores,
  mode: "mcp" | "cli" = "mcp"
): { finalScore: number; penaltyApplied: boolean; penaltyReason?: string } {
  // Reliability is always 0 in Phase 1 — exclude it to avoid penalising every audit.
  // Governance is excluded for CLI mode (--help output has no signing/registry data).
  const fractions = [
    layers.semantic / SCORING_WEIGHTS.semantic,
    layers.schema / SCORING_WEIGHTS.schema,
    ...(mode === "mcp" ? [layers.governance / SCORING_WEIGHTS.governance] : []),
  ];

  const lowestFraction = Math.min(...fractions);

  if (lowestFraction < 0.30) {
    return {
      finalScore: Math.min(baseScore, 20),
      penaltyApplied: true,
      penaltyReason: "Likely Invisible — one category scored below 30%",
    };
  }

  if (lowestFraction < 0.50) {
    return {
      finalScore: Math.round(baseScore * 0.45),
      penaltyApplied: true,
      penaltyReason: "Heavy penalty — one category scored below 50%",
    };
  }

  return { finalScore: baseScore, penaltyApplied: false };
}

// ─── Selection Probability Lift ───────────────────────────────────────────────

/**
 * PROVISIONAL — to be calibrated with real orchestrator data.
 * Lift = exp((score - 50) / 30)
 * Score 20 → 0.33×, 50 → 1.0× (baseline), 80 → 2.7×, 95 → 4.5×
 */
export function computeSelectionLift(finalScore: number): number {
  return Math.exp((finalScore - LIFT_BASELINE_SCORE) / LIFT_SCALE_FACTOR);
}

// ─── Layer 2 (CLI): Interface Hygiene (max 30 pts) ────────────────────────────

/**
 * Scores a CLI tool's agent-friendliness based on its --help output.
 *
 * - JSON output mode  (0–10): structured output is mandatory for agent use
 * - Non-interactive   (0–8):  must run without prompts in automated pipelines
 * - Subcommands       (0–7):  documented hierarchy aids orchestrator planning
 * - --help flag       (0–5):  self-documenting tools are easier to discover
 */
export function scoreCLISchemaLayer(tool: ParsedCLITool): {
  points: number;
  detail: CLISchemaDetail;
} {
  // JSON output (0–10)
  const jsonOutputScore = tool.hasJsonOutput ? 10 : 0;

  // Non-interactive mode (0–8)
  const nonInteractiveScore = tool.hasNonInteractiveMode ? 8 : 0;

  // Subcommands documented (0–7)
  let subcommandScore = 0;
  if (tool.subcommands.length >= 3) subcommandScore = 7;
  else if (tool.subcommands.length >= 1) subcommandScore = 4;

  // --help flag (0–5)
  const helpFlagScore = tool.hasHelpFlag ? 5 : 0;

  return {
    points: jsonOutputScore + nonInteractiveScore + subcommandScore + helpFlagScore,
    detail: { jsonOutputScore, nonInteractiveScore, subcommandScore, helpFlagScore },
  };
}

// ─── CLI semantic layer adaptor ───────────────────────────────────────────────

/**
 * Wraps a ParsedCLITool into a shape compatible with scoreSemanticLayer.
 * The CLI tool name + description map to the MCP primaryTool equivalent.
 */
function cliToolAsMCPShape(tool: ParsedCLITool): ParsedMCPServer {
  return {
    manifest: { tools: [{ name: tool.name, description: tool.description }] },
    primaryTool: { name: tool.name, description: tool.description },
    totalTokens: tool.totalTokens,
    avgTokensPerTool: tool.totalTokens, // single tool = same
    fetchDurationMs: 0,
    rawJson: tool.rawHelp,
    sourceUrl: "",
  };
}

// ─── CLI main entry point ─────────────────────────────────────────────────────

export async function scoreCLITool(
  tool: ParsedCLITool,
  intentResult: IntentResult
): Promise<CLIAuditBreakdown> {
  const fakeServer = cliToolAsMCPShape(tool);
  const semanticResult = scoreSemanticLayer(fakeServer, intentResult);
  const schemaResult = scoreCLISchemaLayer(tool);
  const reliabilityResult = scoreReliabilityLayer(fakeServer);
  const governanceResult = scoreGovernanceLayer(fakeServer);

  const layers: LayerScores = {
    semantic: semanticResult.points,
    schema: schemaResult.points,
    reliability: reliabilityResult.points,
    governance: governanceResult.points,
  };

  const baseScore =
    layers.semantic + layers.schema + layers.reliability + layers.governance;

  const { finalScore, penaltyApplied, penaltyReason } = applyPenaltyRule(
    baseScore,
    layers,
    "cli"
  );

  const selectionLift = computeSelectionLift(finalScore);

  return {
    layers,
    details: {
      semantic: semanticResult.detail,
      schema: schemaResult.detail,
      reliability: reliabilityResult.detail,
      governance: governanceResult.detail,
    },
    baseScore,
    finalScore,
    availablePoints: PHASE1_AVAILABLE_POINTS,
    penaltyApplied,
    penaltyReason,
    selectionLift,
    totalManifestTokens: tool.totalTokens,
    avgTokensPerTool: tool.totalTokens,
    mode: "cli",
    toolCount: 1,
    primaryToolName: tool.name,
    primaryToolDescription: tool.description,
    rawHelpText: tool.rawHelp,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function scoreMCPServer(
  server: ParsedMCPServer,
  intentResult: IntentResult
): Promise<AuditBreakdown> {
  const semanticResult = scoreSemanticLayer(server, intentResult);
  const schemaResult = scoreSchemaLayer(server);
  const reliabilityResult = scoreReliabilityLayer(server);
  const governanceResult = scoreGovernanceLayer(server);

  const layers: LayerScores = {
    semantic: semanticResult.points,
    schema: schemaResult.points,
    reliability: reliabilityResult.points,
    governance: governanceResult.points,
  };

  const baseScore =
    layers.semantic + layers.schema + layers.reliability + layers.governance;

  const { finalScore, penaltyApplied, penaltyReason } = applyPenaltyRule(
    baseScore,
    layers,
    "mcp"
  );

  const selectionLift = computeSelectionLift(finalScore);

  return {
    layers,
    details: {
      semantic: semanticResult.detail,
      schema: schemaResult.detail,
      reliability: reliabilityResult.detail,
      governance: governanceResult.detail,
    },
    baseScore,
    finalScore,
    availablePoints: PHASE1_AVAILABLE_POINTS,
    penaltyApplied,
    penaltyReason,
    selectionLift,
    totalManifestTokens: server.totalTokens,
    avgTokensPerTool: server.avgTokensPerTool,
    mode: "mcp",
    toolCount: server.manifest.tools.length,
    primaryToolName: server.primaryTool.name,
    primaryToolDescription: server.primaryTool.description,
  };
}
