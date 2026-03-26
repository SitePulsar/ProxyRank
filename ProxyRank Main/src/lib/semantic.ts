import OpenAI from "openai";
import type { MCPTool } from "./types";
import {
  AGENTIC_INTENTS,
  PROVISIONAL_THRESHOLD_COSINE_SIMILARITY,
} from "./constants";
import { INTENT_EMBEDDINGS } from "./intent-embeddings";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Core math ────────────────────────────────────────────────────────────────

/** Cosine similarity between two equal-length vectors. Returns [-1, 1]. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─── Embedding fetch ──────────────────────────────────────────────────────────

/**
 * Fetches an embedding vector from OpenAI (text-embedding-3-small, 1536 dims).
 * Cost: ~$0.00000002 per token. A typical tool description = ~$0.0000001.
 */
export async function embedText(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8192), // hard cap for safety
  });
  return res.data[0].embedding;
}

// ─── Tool embed text ──────────────────────────────────────────────────────────

/** Builds the compound string used to embed a tool for intent matching. */
export function buildToolEmbedText(tool: MCPTool): string {
  const parts = [tool.name];
  if (tool.description) parts.push(tool.description);
  return parts.join(": ");
}

// ─── Intent alignment scoring ─────────────────────────────────────────────────

/**
 * Maps cosine similarity to 0–10 points.
 * PROVISIONAL thresholds — calibrate at n=100 audits.
 */
function similarityToPoints(sim: number): number {
  if (sim >= PROVISIONAL_THRESHOLD_COSINE_SIMILARITY) return 10; // ≥ 0.82
  if (sim >= 0.72) return 7;
  if (sim >= 0.60) return 4;
  if (sim >= 0.45) return 2;
  return 0;
}

/**
 * Scores a tool against the 36 pre-computed intent embeddings from INTENT_EMBEDDINGS.
 * Makes one OpenAI call (to embed the tool description), then computes
 * cosine similarity locally against all 36 stored vectors.
 */
export async function scoreIntentAlignment(tool: MCPTool): Promise<{
  score: number;
  topSimilarity: number;
  topIntents: string[];
}> {
  const toolText = buildToolEmbedText(tool);
  const toolEmbedding = await embedText(toolText);

  const similarities = AGENTIC_INTENTS.map((intent) => {
    const stored = INTENT_EMBEDDINGS[intent.label];
    return {
      label: intent.label,
      sim: stored ? cosineSimilarity(toolEmbedding, stored) : 0,
    };
  });

  similarities.sort((a, b) => b.sim - a.sim);

  const top = similarities[0];
  const topIntents = similarities.slice(0, 3).map((s) => s.label);

  return {
    score: similarityToPoints(top.sim),
    topSimilarity: top.sim,
    topIntents,
  };
}
