import Anthropic from "@anthropic-ai/sdk";
import type { AuditBreakdown, MCPTool } from "./types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RewriteSuggestion {
  field: string;        // e.g. "Tool Name", "Description"
  before: string;       // original value (or "missing")
  after: string;        // suggested replacement
  pointsGained: number; // estimated score improvement
  reason: string;       // one sentence explaining why
}

export interface RewriteResult {
  suggestions: RewriteSuggestion[];
  projectedPointsGained: number;
}

// ─── MCP rewriter ─────────────────────────────────────────────────────────────

export async function rewriteMCPTool(
  tool: MCPTool,
  breakdown: AuditBreakdown
): Promise<RewriteResult> {
  const { details } = breakdown;
  const s = details.semantic;
  const sc = details.schema;

  const focusAreas: string[] = [];
  if (s.toolNameScore < 6) focusAreas.push("tool name");
  if (s.descriptionScore < 8) focusAreas.push("description");
  if (sc.outputSchemaScore < 4) focusAreas.push("output schema");
  if (sc.paramDescriptionsScore < 6) focusAreas.push("parameter descriptions");
  if (sc.requiredDefaultsScore < 3) focusAreas.push("required array and defaults");

  if (focusAreas.length === 0) {
    return { suggestions: [], projectedPointsGained: 0 };
  }

  const prompt = `You are an expert at optimizing MCP (Model Context Protocol) tool definitions for AI orchestrator discoverability.

Current tool definition:
Name: ${tool.name}
Description: ${tool.description ?? "(missing)"}
Parameters: ${JSON.stringify(tool.parameters ?? {}, null, 2)}
Output schema: ${JSON.stringify(tool.output ?? {}, null, 2)}

Current scoring weaknesses (focus on these): ${focusAreas.join(", ")}

Scoring criteria:
- Tool name: verb + specific noun, 15–50 chars, snake_case, avoid generic verbs (get, do, run, execute)
- Description: 1–2 sentences, starts with imperative verb (Fetch, Search, Create, Generate, etc.), 50–250 chars, mention output format
- Output schema: should have type, description, and properties
- Parameter descriptions: each param needs a description ≥15 chars
- Required array: must list which params are required; optional params should have defaults

Return a JSON object with this exact shape:
{
  "suggestions": [
    {
      "field": "Tool Name",
      "before": "<original value or 'missing'>",
      "after": "<your improved version>",
      "pointsGained": <number 1-8>,
      "reason": "<one sentence>"
    }
  ]
}

Only include suggestions for the focus areas listed above. Be specific and actionable. The "after" value should be copy-pasteable.`;

  const response = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? "{}") as { suggestions?: RewriteSuggestion[] };
  const suggestions = (parsed.suggestions ?? []).map((s) => ({
    ...s,
    before: typeof s.before === "string" ? s.before : JSON.stringify(s.before, null, 2),
    after: typeof s.after === "string" ? s.after : JSON.stringify(s.after, null, 2),
    reason: typeof s.reason === "string" ? s.reason : String(s.reason),
  }));
  const projectedPointsGained = suggestions.reduce((sum, s) => sum + (s.pointsGained ?? 0), 0);

  return { suggestions, projectedPointsGained };
}

// ─── CLI rewriter ─────────────────────────────────────────────────────────────

export async function rewriteCLITool(
  rawHelp: string,
  toolName: string,
  breakdown: AuditBreakdown
): Promise<RewriteResult> {
  const schemaDetail = breakdown.details.schema as unknown as {
    jsonOutputScore: number;
    nonInteractiveScore: number;
    subcommandScore: number;
    helpFlagScore: number;
  };

  const focusAreas: string[] = [];
  if (schemaDetail.jsonOutputScore < 10) focusAreas.push("--json or --output=json flag (critical for agent pipelines)");
  if (schemaDetail.nonInteractiveScore < 8) focusAreas.push("--ci or --no-input flag (non-interactive mode)");
  if (schemaDetail.subcommandScore < 4) focusAreas.push("documented subcommands section");
  if (breakdown.details.semantic.descriptionScore < 8) focusAreas.push("tool description (first line of help)");

  if (focusAreas.length === 0) {
    return { suggestions: [], projectedPointsGained: 0 };
  }

  const prompt = `You are an expert at making CLI tools agent-friendly for AI orchestrators like LangGraph and CrewAI.

Current --help output for "${toolName}":
${rawHelp}

Missing or weak areas (focus on these): ${focusAreas.join(", ")}

Scoring criteria for CLI agent-friendliness:
- --json or --output=json flag: allows agents to parse output reliably (10 pts)
- --ci or --no-input flag: lets agents run non-interactively (8 pts)
- Documented subcommands (≥3): helps agents understand tool capabilities (7 pts)
- First-line description: imperative verb, 50–250 chars, mentions what it does (up to 12 pts)

Return a JSON object with this exact shape:
{
  "suggestions": [
    {
      "field": "<flag or section name, e.g. '--json flag', 'Description'>",
      "before": "<current value or 'missing'>",
      "after": "<exact text to add or replace — should be copy-pasteable into help output>",
      "pointsGained": <number 1-10>,
      "reason": "<one sentence explaining why this matters for AI orchestrators>"
    }
  ]
}

Only include suggestions for the focus areas above. Be concrete — show exact flag syntax or description text.`;

  const response = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? "{}") as { suggestions?: RewriteSuggestion[] };
  const suggestions = (parsed.suggestions ?? []).map((s) => ({
    ...s,
    before: typeof s.before === "string" ? s.before : JSON.stringify(s.before, null, 2),
    after: typeof s.after === "string" ? s.after : JSON.stringify(s.after, null, 2),
    reason: typeof s.reason === "string" ? s.reason : String(s.reason),
  }));
  const projectedPointsGained = suggestions.reduce((sum, s) => sum + (s.pointsGained ?? 0), 0);

  return { suggestions, projectedPointsGained };
}
