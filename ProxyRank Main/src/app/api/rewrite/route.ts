import { NextResponse } from "next/server";
import { z } from "zod";
import { validateEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { rewriteMCPTool, rewriteCLITool } from "@/lib/rewriter";
import type { AuditRecord, MCPTool } from "@/lib/types";
import type { RewriteResult } from "@/lib/rewriter";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ─── Soft IP rate limit (3 rewrites per IP per 24h) ──────────────────────────
const RATE_LIMIT = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }
  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT - entry.count };
}

const requestSchema = z.object({
  auditId: z.string().uuid(),
});

export async function POST(request: Request): Promise<NextResponse<RewriteResult | { error: string }>> {
  try {
    validateEnv();
  } catch {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid audit ID" }, { status: 400 });
  }

  const { auditId } = parsed.data;

  // Rate limit by IP
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const { allowed, remaining } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "You've used your 3 free rewrites for today. Come back tomorrow." },
      { status: 429, headers: { "Retry-After": "86400" } }
    );
  }
  console.log(`[rewrite] ip=${ip} remaining=${remaining}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proxy_audits")
    .select("*")
    .eq("id", auditId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Audit not found" }, { status: 404 });
  }

  const record = data as AuditRecord;
  const { breakdown } = record;

  try {
    if (breakdown.mode === "cli") {
      const result = await rewriteCLITool(
        breakdown.rawHelpText ?? "",
        breakdown.primaryToolName ?? record.url.replace("cli://", ""),
        breakdown
      );
      return NextResponse.json(result);
    } else {
      const primaryTool: MCPTool = {
        name: breakdown.primaryToolName ?? "",
        description: breakdown.primaryToolDescription,
      };
      const result = await rewriteMCPTool(primaryTool, breakdown);
      return NextResponse.json(result);
    }
  } catch (err) {
    console.error("[rewrite] LLM call failed:", err);
    return NextResponse.json({ error: "Rewrite failed — please try again" }, { status: 500 });
  }
}
