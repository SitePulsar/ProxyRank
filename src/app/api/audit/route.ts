import { NextResponse } from "next/server";
import { z } from "zod";
import { validateEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAndParseMCPManifest, MCPParseError } from "@/lib/mcp-parser";
import { connectAndListTools, MCPProtocolError } from "@/lib/mcp-protocol-client";
import { scoreIntentAlignment } from "@/lib/semantic";
import { scoreMCPServer } from "@/lib/scorer";
import type { AuditResponse, AuditError, ParsedMCPServer } from "@/lib/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  url: z.string().url().max(2048),
});

export async function POST(request: Request): Promise<NextResponse<AuditResponse | AuditError>> {
  try {
    validateEnv();
  } catch (err) {
    console.error("[audit] env validation failed:", err);
    return NextResponse.json({ error: "Server misconfiguration", code: "INTERNAL" }, { status: 500 });
  }

  // Parse + validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_URL" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please provide a valid URL (https://...)", code: "INVALID_URL" },
      { status: 400 }
    );
  }

  const { url } = parsed.data;

  // Block localhost — Vercel cannot reach private machines
  try {
    const { hostname } = new URL(url);
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.endsWith(".local")
    ) {
      return NextResponse.json(
        {
          error: "ProxyRank runs in the cloud and cannot reach localhost. Use ngrok to create a public tunnel (ngrok http 3000) and paste the ngrok URL instead.",
          code: "LOCALHOST_BLOCKED",
        },
        { status: 422 }
      );
    }
  } catch {
    // URL already validated above
  }

  // Strategy 1: try static manifest (fast, works for .json URLs)
  // Strategy 2: fall back to live MCP protocol client (JSON-RPC tools/list)
  let server: ParsedMCPServer;
  try {
    server = await fetchAndParseMCPManifest(url);
  } catch (staticErr) {
    // Static manifest failed — try live MCP protocol
    console.log("[audit] static manifest failed, trying MCP protocol client...");
    try {
      server = await connectAndListTools(url);
    } catch (protocolErr) {
      // Both failed — return the most useful error
      if (protocolErr instanceof MCPProtocolError && protocolErr.code === "AUTH_REQUIRED") {
        return NextResponse.json(
          { error: "This MCP server requires authentication. ProxyRank can only audit public servers.", code: "FETCH_FAILED" },
          { status: 422 }
        );
      }
      // Propagate specific static error code if available
      if (staticErr instanceof MCPParseError && staticErr.code !== "FETCH_FAILED") {
        return NextResponse.json(
          { error: staticErr.message, code: staticErr.code },
          { status: 422 }
        );
      }
      return NextResponse.json(
        { error: "Could not reach this MCP server. It may require authentication, or the URL may not point to a public MCP endpoint.", code: "FETCH_FAILED" },
        { status: 422 }
      );
    }
  }

  // Score intent alignment (single OpenAI embed call)
  let intentResult;
  try {
    intentResult = await scoreIntentAlignment(server.primaryTool);
  } catch (err) {
    console.error("[audit] intent alignment failed:", err);
    // Degrade gracefully — use zero score rather than failing the whole audit
    intentResult = { score: 0, topSimilarity: 0, topIntents: [] };
  }

  // Run the full scoring rubric
  const breakdown = await scoreMCPServer(server, intentResult);

  // Persist to Supabase
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("proxy_audits")
    .insert({
      url,
      score: breakdown.finalScore,
      mode: "mcp",
      breakdown,
      user_id: null, // anonymous — Phase 1 has no auth
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[audit] supabase insert failed:", error);
    return NextResponse.json(
      { error: "Failed to save audit result", code: "INTERNAL" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    auditId: data.id,
    score: breakdown.finalScore,
    availablePoints: breakdown.availablePoints,
  });
}
