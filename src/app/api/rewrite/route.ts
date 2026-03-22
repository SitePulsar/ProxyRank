import { NextResponse } from "next/server";
import { z } from "zod";
import { validateEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { rewriteMCPTool, rewriteCLITool } from "@/lib/rewriter";
import type { AuditRecord, MCPTool } from "@/lib/types";
import type { RewriteResult } from "@/lib/rewriter";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

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
