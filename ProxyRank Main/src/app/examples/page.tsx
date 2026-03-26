import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import type { AuditRecord } from "@/lib/types";

export const metadata: Metadata = {
  title: "Example Audits — ProxyRank",
  description:
    "See how well-known MCP implementations score on the ProxyRank rubric — Stripe, GitHub, and Slack.",
};

function scoreColor(score: number) {
  if (score >= 70) return "text-green-400";
  if (score >= 40) return "text-yellow-400";
  return "text-red-400";
}

function scoreLabel(score: number) {
  if (score >= 70) return "Discoverable";
  if (score >= 40) return "Emerging";
  return "Poor";
}

export default async function ExamplesPage() {
  const supabase = await createClient();
  const { data: audits } = await supabase
    .from("proxy_audits")
    .select("*")
    .eq("is_gold_standard", true)
    .order("score", { ascending: false });

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
            ← Audit your agent
          </Link>
        </div>
      </div>

      <div className="container py-10 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Gold Standard Audits
          </h1>
          <p className="text-muted-foreground">
            How well-known, production MCP implementations score on the ProxyRank rubric.
            Use these as comparison anchors for your own agent.
          </p>
        </div>

        {!audits || audits.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-muted-foreground">
              No example audits yet. Run the gold standards SQL seed first.
            </p>
            <code className="mt-3 block text-xs text-muted-foreground/60">
              supabase/seeds/gold_standards.sql
            </code>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {(audits as AuditRecord[]).map((audit) => (
              <Link
                key={audit.id}
                href={`/results/${audit.id}`}
                className="group rounded-xl border border-border bg-card p-6 hover:border-primary/50 transition-colors"
              >
                <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">
                  Gold Standard
                </p>
                <p className="text-lg font-semibold text-foreground mb-1">
                  {audit.label ?? "Unknown"}
                </p>
                <p className="text-xs text-muted-foreground truncate mb-4" title={audit.url}>
                  {audit.url}
                </p>
                <div className="flex items-end justify-between">
                  <div>
                    <p className={`text-4xl font-bold tabular-nums ${scoreColor(audit.score)}`}>
                      {audit.score}
                    </p>
                    <p className="text-xs text-muted-foreground">ProxyScore</p>
                  </div>
                  <span className={`text-sm font-medium ${scoreColor(audit.score)}`}>
                    {scoreLabel(audit.score)}
                  </span>
                </div>
                <p className="mt-4 text-xs text-primary group-hover:underline">
                  View full breakdown →
                </p>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-10 rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            Want to see how your agent compares to these?
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Audit my agent free →
          </Link>
        </div>
      </div>
    </main>
  );
}
