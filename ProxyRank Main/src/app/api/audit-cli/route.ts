import { NextResponse } from "next/server";
import { z } from "zod";
import { validateEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCLIHelp } from "@/lib/cli-parser";
import { scoreIntentAlignment } from "@/lib/semantic";
import { scoreCLITool } from "@/lib/scorer";
import type { AuditResponse, AuditError } from "@/lib/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  helpText: z.string().min(10).max(20000),
  name: z.string().max(128).optional(),
});

export async function POST(request: Request): Promise<NextResponse<AuditResponse | AuditError>> {
  try {
    validateEnv();
  } catch (err) {
    console.error("[audit-cli] env validation failed:", err);
    return NextResponse.json({ error: "Server misconfiguration", code: "INTERNAL" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_URL" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please provide --help output (at least 10 characters).", code: "INVALID_URL" },
      { status: 400 }
    );
  }

  const { helpText, name } = parsed.data;

  // Parse the --help output
  const tool = parseCLIHelp(helpText, name);

  // Score intent alignment against the tool name + description
  let intentResult;
  try {
    intentResult = await scoreIntentAlignment({
      name: tool.name,
      description: tool.description,
    });
  } catch (err) {
    console.error("[audit-cli] intent alignment failed:", err);
    intentResult = { score: 0, topSimilarity: 0, topIntents: [] };
  }

  // Run scoring rubric
  const breakdown = await scoreCLITool(tool, intentResult);

  // Persist to Supabase — use the tool name as the "url" identifier
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("proxy_audits")
    .insert({
      url: `cli://${tool.name}`,
      score: breakdown.finalScore,
      mode: "cli",
      breakdown,
      user_id: null,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[audit-cli] supabase insert failed:", error);
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
