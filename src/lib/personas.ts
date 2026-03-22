import type { LayerScores } from "./types";

// ─── Persona definitions ───────────────────────────────────────────────────────

export interface OrchestratorPersona {
  id: string;
  name: string;
  tagline: string;
  weights: { semantic: number; schema: number; reliability: number; governance: number };
  threshold: number; // normalized 0-100 score above which it would select
  primaryConcern: string; // what it weighs most
}

export interface PersonaAssessment {
  persona: OrchestratorPersona;
  score: number;          // 0-100 weighted
  wouldSelect: boolean;
  verdict: "Selects" | "Borderline" | "Rejects";
  strength: string;       // what this orchestrator likes
  weakness: string;       // what holds it back
  fixFirst: string;       // most impactful single fix
}

export const PERSONAS: OrchestratorPersona[] = [
  {
    id: "langgraph",
    name: "LangGraph",
    tagline: "Graph-based agent orchestration",
    weights: { semantic: 0.30, schema: 0.55, reliability: 0.10, governance: 0.05 },
    threshold: 58,
    primaryConcern: "structured I/O for graph node execution",
  },
  {
    id: "crewai",
    name: "CrewAI",
    tagline: "Role-based multi-agent delegation",
    weights: { semantic: 0.55, schema: 0.25, reliability: 0.10, governance: 0.10 },
    threshold: 48,
    primaryConcern: "semantic clarity for role assignment",
  },
  {
    id: "openai-assistants",
    name: "OpenAI Assistants",
    tagline: "Function calling via Assistants API",
    weights: { semantic: 0.25, schema: 0.65, reliability: 0.05, governance: 0.05 },
    threshold: 62,
    primaryConcern: "strict JSON schema for function calling",
  },
  {
    id: "autogen",
    name: "AutoGen",
    tagline: "Microsoft multi-agent conversations",
    weights: { semantic: 0.45, schema: 0.35, reliability: 0.10, governance: 0.10 },
    threshold: 52,
    primaryConcern: "capability clarity for conversation routing",
  },
];

// ─── Scoring ───────────────────────────────────────────────────────────────────

function normalize(layers: LayerScores) {
  return {
    semantic: (layers.semantic / 35) * 100,
    schema: (layers.schema / 30) * 100,
    reliability: (layers.reliability / 25) * 100,
    governance: (layers.governance / 10) * 100,
  };
}

function buildReasoning(
  persona: OrchestratorPersona,
  norm: ReturnType<typeof normalize>,
  score: number
): Pick<PersonaAssessment, "strength" | "weakness" | "fixFirst"> {
  const { id } = persona;

  // Find highest and lowest normalized layers
  const entries = Object.entries(norm) as [keyof typeof norm, number][];
  const [bestLayer] = entries.sort(([, a], [, b]) => b - a);
  const [worstLayer] = entries.sort(([, a], [, b]) => a - b);

  const layerLabel: Record<string, string> = {
    semantic: "Semantic clarity",
    schema: "Schema quality",
    reliability: "Reliability signals",
    governance: "Governance metadata",
  };

  // Persona-specific reasoning
  const strengths: Record<string, string> = {
    langgraph: norm.schema >= 60
      ? "Schema layer is strong — LangGraph can reliably pass typed parameters between graph nodes."
      : "Tool name is parseable — LangGraph can reference it in node definitions.",
    crewai: norm.semantic >= 60
      ? "Semantic layer is strong — CrewAI agents can infer the tool's role from its description."
      : "Tool is detectable — CrewAI can assign it to agents with matching roles.",
    "openai-assistants": norm.schema >= 60
      ? "Schema is well-defined — OpenAI function calling can serialize inputs correctly."
      : "Tool name is usable — Assistants API can register it as a function.",
    autogen: norm.semantic >= 55
      ? "Description is clear enough for AutoGen agents to route conversation turns."
      : "Tool is discoverable — AutoGen can include it in agent capability lists.",
  };

  const weaknesses: Record<string, string> = {
    langgraph: norm.schema < 50
      ? "Output schema is missing or incomplete — LangGraph cannot reliably parse return values for downstream nodes."
      : norm.semantic < 40
      ? "Description is too vague for LangGraph to auto-select this tool during graph construction."
      : "Reliability data unavailable — LangGraph retry logic cannot be tuned for this tool.",
    crewai: norm.semantic < 50
      ? "Tool description lacks imperative verbs and domain context — CrewAI agents cannot match it to task goals."
      : norm.governance < 30
      ? "No registry or signing — CrewAI cannot verify tool provenance in multi-agent pipelines."
      : "Schema coverage is thin — structured output parsing may fail in some crew workflows.",
    "openai-assistants": norm.schema < 60
      ? "JSON schema is incomplete — OpenAI function calling requires typed parameters with descriptions for every argument."
      : norm.semantic < 40
      ? "Description doesn't start with an imperative verb — Assistants may misclassify the tool's purpose."
      : "Reliability unknown — Assistants API cannot estimate retry cost for this function.",
    autogen: norm.semantic < 50
      ? "Tool capability is unclear — AutoGen conversation routing relies on natural-language descriptions to select tools."
      : norm.schema < 40
      ? "Parameter schema is weak — AutoGen agents may construct malformed calls."
      : "Governance signals absent — AutoGen cannot assess tool trustworthiness in multi-agent pipelines.",
  };

  const fixes: Record<string, string> = {
    langgraph: norm.schema < 50
      ? "Add a fully typed output schema with properties and descriptions."
      : norm.semantic < 40
      ? "Rewrite the description to start with an imperative verb and mention output format."
      : "Add async:true and document latency expectations.",
    crewai: norm.semantic < 50
      ? "Rewrite the description with an imperative verb and clear domain context (e.g., 'Generate product recommendations from a shopping cart')."
      : norm.governance < 30
      ? "Register in a public MCP registry to give CrewAI trust signals."
      : "Add required: [] array to parameter schema.",
    "openai-assistants": norm.schema < 60
      ? "Add descriptions to every parameter (≥15 chars each) and define a required: [] array."
      : norm.semantic < 40
      ? "Start description with imperative verb and keep it under 250 characters."
      : "Add output schema with type and properties.",
    autogen: norm.semantic < 50
      ? "Write a 1–2 sentence description starting with an imperative verb that explains what the tool returns."
      : norm.schema < 40
      ? "Add parameter types and descriptions so AutoGen agents can construct valid calls."
      : "Add signing metadata to pass AutoGen's trust filter.",
  };

  return {
    strength: strengths[id] ?? `${layerLabel[bestLayer[0]]} is the strongest signal for ${persona.name}.`,
    weakness: weaknesses[id] ?? `${layerLabel[worstLayer[0]]} is too low for ${persona.name}'s selection threshold.`,
    fixFirst: fixes[id] ?? `Improve ${layerLabel[worstLayer[0]].toLowerCase()} to cross ${persona.name}'s selection threshold.`,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function assessPersonas(layers: LayerScores): PersonaAssessment[] {
  const norm = normalize(layers);

  return PERSONAS.map((persona) => {
    const score = Math.round(
      persona.weights.semantic * norm.semantic +
      persona.weights.schema * norm.schema +
      persona.weights.reliability * norm.reliability +
      persona.weights.governance * norm.governance
    );

    const wouldSelect = score >= persona.threshold;
    const verdict: PersonaAssessment["verdict"] =
      score >= persona.threshold ? "Selects"
      : score >= persona.threshold - 10 ? "Borderline"
      : "Rejects";

    return {
      persona,
      score,
      wouldSelect,
      verdict,
      ...buildReasoning(persona, norm, score),
    };
  });
}
