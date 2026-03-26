import type { MCPManifest, MCPTool, ParsedMCPServer } from "./types";
import { countApproximateTokens, selectPrimaryTool } from "./mcp-parser";

// ─── JSON-RPC types ───────────────────────────────────────────────────────────

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface MCPInputSchema {
  type?: string;
  properties?: Record<string, {
    type?: string;
    description?: string;
    enum?: string[];
    default?: unknown;
    [key: string]: unknown;
  }>;
  required?: string[];
}

interface MCPProtocolTool {
  name: string;
  description?: string;
  inputSchema?: MCPInputSchema;
}

interface ToolsListResult {
  tools: MCPProtocolTool[];
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class MCPProtocolError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CONNECT_FAILED"
      | "AUTH_REQUIRED"
      | "PROTOCOL_ERROR"
      | "NO_TOOLS"
      | "TIMEOUT"
  ) {
    super(message);
    this.name = "MCPProtocolError";
  }
}

// ─── Endpoint candidates ──────────────────────────────────────────────────────

function candidateEndpoints(rawUrl: string): string[] {
  const base = rawUrl.replace(/\/$/, "");
  return [
    base,
    `${base}/mcp`,
    `${base}/api/mcp`,
    `${base}/api`,
    `${base}/rpc`,
  ].filter((u, i, arr) => arr.indexOf(u) === i);
}

// ─── SSE response parser ──────────────────────────────────────────────────────

/**
 * Extracts the first JSON-RPC result from an SSE stream body.
 * MCP Streamable HTTP may return SSE instead of plain JSON.
 */
function parseSSEResponse(text: string): JSONRPCResponse | null {
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data:")) {
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        return JSON.parse(data) as JSONRPCResponse;
      } catch {
        continue;
      }
    }
  }
  return null;
}

// ─── Single JSON-RPC call ─────────────────────────────────────────────────────

async function jsonRpc(
  endpoint: string,
  request: JSONRPCRequest,
  timeoutMs: number
): Promise<JSONRPCResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "User-Agent": "ProxyRank/0.1 (MCP Audit)",
      },
      body: JSON.stringify(request),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new MCPProtocolError(`Timeout after ${timeoutMs}ms`, "TIMEOUT");
    }
    throw new MCPProtocolError(
      `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      "CONNECT_FAILED"
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new MCPProtocolError(
      `Server requires authentication (HTTP ${res.status})`,
      "AUTH_REQUIRED"
    );
  }

  if (!res.ok) {
    throw new MCPProtocolError(
      `HTTP ${res.status} from ${endpoint}`,
      "CONNECT_FAILED"
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();

  // Plain JSON response
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(body) as JSONRPCResponse;
    } catch {
      throw new MCPProtocolError("Response is not valid JSON", "PROTOCOL_ERROR");
    }
  }

  // SSE response (Streamable HTTP transport)
  if (contentType.includes("text/event-stream") || body.includes("data:")) {
    const parsed = parseSSEResponse(body);
    if (parsed) return parsed;
    throw new MCPProtocolError("Could not parse SSE response", "PROTOCOL_ERROR");
  }

  throw new MCPProtocolError(
    `Unexpected content-type: ${contentType}`,
    "PROTOCOL_ERROR"
  );
}

// ─── Protocol tool → our MCPTool shape ───────────────────────────────────────

function mapProtocolTool(pt: MCPProtocolTool): MCPTool {
  const props = pt.inputSchema?.properties;
  const required = pt.inputSchema?.required;

  return {
    name: pt.name,
    description: pt.description,
    parameters: props
      ? {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(props).map(([k, v]) => [
              k,
              {
                type: v.type ?? "string",
                description: v.description,
                enum: v.enum,
                default: v.default,
              },
            ])
          ),
          required,
        }
      : undefined,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Connects to a live MCP server via JSON-RPC (Streamable HTTP transport),
 * runs initialize + tools/list, and returns a ParsedMCPServer.
 *
 * Tries multiple common endpoint paths automatically.
 *
 * @throws MCPProtocolError if connection or protocol fails on all candidates.
 */
export async function connectAndListTools(
  url: string,
  timeoutMs = 8000
): Promise<ParsedMCPServer> {
  const endpoints = candidateEndpoints(url);
  const startMs = Date.now();
  let lastError: MCPProtocolError | null = null;

  for (const endpoint of endpoints) {
    // Step 1: initialize
    let initRes: JSONRPCResponse;
    try {
      initRes = await jsonRpc(
        endpoint,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "ProxyRank", version: "0.1.0" },
          },
        },
        timeoutMs
      );
    } catch (err) {
      lastError = err instanceof MCPProtocolError
        ? err
        : new MCPProtocolError(String(err), "CONNECT_FAILED");
      continue;
    }

    if (initRes.error) {
      lastError = new MCPProtocolError(
        `Initialize failed: ${initRes.error.message}`,
        "PROTOCOL_ERROR"
      );
      continue;
    }

    // Step 2: tools/list
    let toolsRes: JSONRPCResponse;
    try {
      toolsRes = await jsonRpc(
        endpoint,
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        timeoutMs
      );
    } catch (err) {
      lastError = err instanceof MCPProtocolError
        ? err
        : new MCPProtocolError(String(err), "CONNECT_FAILED");
      continue;
    }

    if (toolsRes.error) {
      lastError = new MCPProtocolError(
        `tools/list failed: ${toolsRes.error.message}`,
        "PROTOCOL_ERROR"
      );
      continue;
    }

    const result = toolsRes.result as ToolsListResult | undefined;
    if (!result?.tools || result.tools.length === 0) {
      lastError = new MCPProtocolError(
        "Server returned no tools",
        "NO_TOOLS"
      );
      continue;
    }

    // Map to our manifest shape
    const tools: MCPTool[] = result.tools.map(mapProtocolTool);

    const manifest: MCPManifest = {
      tools,
      // Synthesize metadata from initialize response if available
      name_for_model: (initRes.result as Record<string, unknown>)?.serverInfo
        ? String((initRes.result as Record<string, { name?: string }>).serverInfo?.name ?? "")
        : undefined,
    };

    const rawJson = JSON.stringify(manifest);
    const totalTokens = countApproximateTokens(rawJson);
    const avgTokensPerTool = Math.ceil(totalTokens / tools.length);
    const primaryTool = selectPrimaryTool(manifest);
    const fetchDurationMs = Date.now() - startMs;

    return {
      manifest,
      primaryTool,
      totalTokens,
      avgTokensPerTool,
      fetchDurationMs,
      rawJson,
      sourceUrl: endpoint,
    };
  }

  throw (
    lastError ??
    new MCPProtocolError(
      `Could not connect to MCP server at ${url}`,
      "CONNECT_FAILED"
    )
  );
}
