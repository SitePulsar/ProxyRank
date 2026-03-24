import { z } from "zod";
import type { MCPManifest, MCPTool, ParsedMCPServer } from "./types";

// ─── Zod schemas (permissive by design — deduct points, never throw) ──────────

const mcpToolParamSchema = z
  .object({
    type: z.string().default("string"),
    description: z.string().optional(),
    enum: z.array(z.string()).optional(),
    default: z.unknown().optional(),
  })
  .passthrough();

const mcpToolSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z
      .object({
        type: z.literal("object").default("object"),
        properties: z.record(z.string(), mcpToolParamSchema).optional(),
        required: z.array(z.string()).optional(),
      })
      .optional(),
    output: z
      .object({
        type: z.string(),
        description: z.string().optional(),
        properties: z.record(z.string(), mcpToolParamSchema).optional(),
      })
      .optional(),
    async: z.boolean().optional(),
  })
  .passthrough();

const mcpManifestSchema = z
  .object({
    tools: z.array(mcpToolSchema).min(1),
    schema_version: z.string().optional(),
    name_for_human: z.string().optional(),
    name_for_model: z.string().optional(),
    description_for_human: z.string().optional(),
    description_for_model: z.string().optional(),
    signing: z
      .object({
        algorithm: z.string().optional(),
        signature: z.string().optional(),
        public_key_url: z.string().optional(),
      })
      .optional(),
    registries: z.array(z.string()).optional(),
    domain_verification: z
      .object({
        verified: z.boolean(),
        method: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

// ─── Error class ──────────────────────────────────────────────────────────────

export class MCPParseError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "FETCH_FAILED"
      | "INVALID_JSON"
      | "INVALID_SCHEMA"
      | "TIMEOUT"
      | "AUTH_REQUIRED"
      | "HTML_RESPONSE"
      | "NOT_FOUND"
  ) {
    super(message);
    this.name = "MCPParseError";
  }
}

// ─── Token counting ───────────────────────────────────────────────────────────

/**
 * Approximates token count using a 4-chars-per-token heuristic.
 * Good enough for efficiency scoring; not suitable for billing.
 */
export function countApproximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Primary tool selection ───────────────────────────────────────────────────

/**
 * Selects the "primary" tool to audit from a manifest.
 * Prefers the tool with the longest combined name + description length
 * as a proxy for the most intentionally documented entry.
 */
export function selectPrimaryTool(manifest: MCPManifest): MCPTool {
  return manifest.tools.reduce((best, tool) => {
    const score =
      (tool.name?.length ?? 0) + (tool.description?.length ?? 0);
    const bestScore =
      (best.name?.length ?? 0) + (best.description?.length ?? 0);
    return score > bestScore ? tool : best;
  });
}

// ─── GitHub URL normalizer ────────────────────────────────────────────────────

/**
 * Converts GitHub UI URLs to raw.githubusercontent.com equivalents so the
 * parser can fetch the actual JSON instead of an HTML page.
 *
 * Handles:
 *   github.com/user/repo/blob/branch/path/to/file.json
 *     → raw.githubusercontent.com/user/repo/branch/path/to/file.json
 */
function normalizeGitHubUrl(url: string): string {
  const blobMatch = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/
  );
  if (blobMatch) {
    const [, user, repo, branch, path] = blobMatch;
    return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`;
  }
  return url;
}

// ─── Manifest URLs to try ─────────────────────────────────────────────────────

function candidateUrls(rawUrl: string): string[] {
  const normalized = normalizeGitHubUrl(rawUrl);
  const base = normalized.replace(/\/$/, "");

  // If URL already points directly to a JSON file, only try it as-is
  if (/\.json$/i.test(base)) {
    return [normalized];
  }

  // GitHub repo root → try known raw paths on main + master
  const repoMatch = normalized.match(
    /github\.com\/([^/]+)\/([^/]+)\/?$/
  );
  if (repoMatch) {
    const [, user, repo] = repoMatch;
    const raw = `https://raw.githubusercontent.com/${user}/${repo}`;
    return [
      `${raw}/main/mcp.json`,
      `${raw}/main/.well-known/mcp.json`,
      `${raw}/master/mcp.json`,
      `${raw}/master/.well-known/mcp.json`,
    ];
  }

  return [
    normalized,
    `${base}/.well-known/mcp.json`,
    `${base}/agent.json`,
    `${base}/mcp.json`,
  ].filter((u, i, arr) => arr.indexOf(u) === i);
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Fetches and parses an MCP manifest from `url`.
 * Tries common well-known paths if the primary URL fails.
 *
 * @throws MCPParseError on fetch failure, invalid JSON, or schema mismatch.
 */
export async function fetchAndParseMCPManifest(
  url: string,
  timeoutMs = 5000
): Promise<ParsedMCPServer> {
  const candidates = candidateUrls(url);
  const startMs = Date.now();
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    let res: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        res = await fetch(candidate, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new MCPParseError(
          `Request to ${candidate} timed out after ${timeoutMs}ms`,
          "TIMEOUT"
        );
      } else {
        lastError = new MCPParseError(
          `Failed to fetch ${candidate}: ${err instanceof Error ? err.message : String(err)}`,
          "FETCH_FAILED"
        );
      }
      continue;
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        lastError = new MCPParseError(
          `Access denied (${res.status}) — this manifest is private. Orchestrators cannot discover it either. Make the file public to get a ProxyScore.`,
          "AUTH_REQUIRED"
        );
      } else if (res.status === 404) {
        lastError = new MCPParseError(
          `No manifest found at ${candidate}. Check the URL or try adding /.well-known/mcp.json to your domain.`,
          "NOT_FOUND"
        );
      } else {
        lastError = new MCPParseError(
          `HTTP ${res.status} from ${candidate}`,
          "FETCH_FAILED"
        );
      }
      continue;
    }

    // Detect HTML response (GitHub UI page, login wall, etc.)
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      lastError = new MCPParseError(
        `Got an HTML page instead of JSON from ${candidate}. You may have pasted a webpage URL — try the raw JSON link instead.`,
        "HTML_RESPONSE"
      );
      continue;
    }

    // Parse JSON
    let raw: string;
    let json: unknown;
    try {
      raw = await res.text();
      // Secondary HTML check — some servers return HTML with 200 OK
      if (raw.trimStart().startsWith("<!")) {
        lastError = new MCPParseError(
          `Got an HTML page instead of JSON from ${candidate}. You may have pasted a webpage URL — try the raw JSON link instead.`,
          "HTML_RESPONSE"
        );
        continue;
      }
      json = JSON.parse(raw);
    } catch {
      lastError = new MCPParseError(
        `Response from ${candidate} is not valid JSON`,
        "INVALID_JSON"
      );
      continue;
    }

    // Validate schema
    const parsed = mcpManifestSchema.safeParse(json);
    if (!parsed.success) {
      lastError = new MCPParseError(
        `Manifest at ${candidate} failed schema validation: ${parsed.error.issues[0]?.message ?? "unknown"}`,
        "INVALID_SCHEMA"
      );
      continue;
    }

    const manifest = parsed.data as MCPManifest;
    const fetchDurationMs = Date.now() - startMs;
    const totalTokens = countApproximateTokens(raw);
    const avgTokensPerTool = Math.ceil(totalTokens / manifest.tools.length);
    const primaryTool = selectPrimaryTool(manifest);

    return {
      manifest,
      primaryTool,
      totalTokens,
      avgTokensPerTool,
      fetchDurationMs,
      rawJson: raw,
      sourceUrl: candidate,
    };
  }

  // All candidates failed — throw the last error
  throw (
    lastError ??
    new MCPParseError(`Could not find a valid MCP manifest at ${url}`, "FETCH_FAILED")
  );
}
