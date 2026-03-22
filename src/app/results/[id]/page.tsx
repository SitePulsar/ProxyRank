import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ScoreCard } from "@/components/ScoreCard";
import { ProxyRadarChart } from "@/components/ProxyRadarChart";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { GoldStandardComparison } from "@/components/GoldStandardComparison";
import { OrchestratorSimulation } from "@/components/OrchestratorSimulation";
import type { AuditRecord } from "@/lib/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Audit ${id.slice(0, 8)} — ProxyRank`,
    description: "View your MCP server ProxyScore audit results.",
  };
}

export default async function ResultsPage({ params }: PageProps) {
  const { id } = await params;

  const supabase = await createClient();

  // Fetch this audit
  const { data: audit, error } = await supabase
    .from("proxy_audits")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !audit) {
    notFound();
  }

  const record = audit as AuditRecord;

  // Fetch gold standard benchmarks for comparison
  const { data: goldStandards } = await supabase
    .from("proxy_audits")
    .select("id, label, score, breakdown")
    .eq("is_gold_standard", true)
    .order("score", { ascending: false })
    .limit(3);

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border">
        <div className="container py-4 flex items-center justify-between">
          <Link href="/" className="text-lg font-bold text-foreground">
            Proxy<span className="text-primary">Rank</span>
          </Link>
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Run another audit
          </Link>
        </div>
      </div>

      <div className="container py-10 space-y-8 max-w-4xl">
        {/* Score card */}
        <ScoreCard breakdown={record.breakdown} url={record.url} auditId={record.id} />

        {/* Radar + breakdown grid */}
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Radar chart */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Layer Radar
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              All layers normalized to 0–100 for visual comparison.
            </p>
            <ProxyRadarChart layers={record.breakdown.layers} />
          </div>

          {/* Quick stats */}
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Audit Details
            </h2>
            <dl className="space-y-3 text-sm">
              {[
                { label: "Manifest URL", value: record.url },
                { label: "Mode", value: record.breakdown.mode.toUpperCase() },
                { label: "Tools in manifest", value: String(record.breakdown.toolCount) },
                { label: "Total manifest tokens", value: String(record.breakdown.totalManifestTokens) },
                { label: "Avg tokens / tool", value: String(record.breakdown.avgTokensPerTool) },
                { label: "Base score (pre-penalty)", value: String(record.breakdown.baseScore) },
                { label: "Penalty applied", value: record.breakdown.penaltyApplied ? "Yes" : "No" },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium text-foreground truncate max-w-48" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Score breakdown accordion */}
        <ScoreBreakdown breakdown={record.breakdown} />

        {/* Orchestrator simulation */}
        <OrchestratorSimulation layers={record.breakdown.layers} />

        {/* Gold standard comparison */}
        {goldStandards && goldStandards.length > 0 && (
          <GoldStandardComparison
            userScore={record.score}
            userLayers={record.breakdown.layers}
            benchmarks={goldStandards as Array<{ id: string; label: string; score: number; breakdown: { layers: AuditRecord["breakdown"]["layers"] } }>}
          />
        )}
      </div>
    </main>
  );
}
