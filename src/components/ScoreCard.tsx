"use client";

import { useState } from "react";
import { Unlink, Info, Sparkles, Loader2, Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AuditBreakdown } from "@/lib/types";
import type { RewriteResult, RewriteSuggestion } from "@/lib/rewriter";

interface ScoreCardProps {
  breakdown: AuditBreakdown;
  url: string;
  auditId: string;
}

function scoreColor(score: number) {
  if (score >= 70) return "text-green-400";
  if (score >= 40) return "text-yellow-400";
  if (score >= 30) return "text-red-400";
  return "text-red-500";
}

function scoreLabel(score: number) {
  if (score >= 70) return "Discoverable";
  if (score >= 40) return "Emerging";
  if (score >= 30) return "Poor";
  return "Likely Invisible";
}

function scoreBadgeVariant(score: number): "success" | "warning" | "destructive" {
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "destructive";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function SuggestionRow({ s }: { s: RewriteSuggestion }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{s.field}</span>
        <span className="text-xs font-bold text-green-400">+{s.pointsGained} pts</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-start gap-2">
          <span className="text-xs text-red-400 shrink-0 mt-0.5">Before</span>
          <span className="text-xs text-muted-foreground font-mono">{s.before}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-xs text-green-400 shrink-0 mt-0.5">After</span>
          <span className="text-xs text-foreground font-mono flex-1">{s.after}</span>
          <CopyButton text={s.after} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground border-t border-border pt-2">{s.reason}</p>
    </div>
  );
}

export function ScoreCard({ breakdown, url, auditId }: ScoreCardProps) {
  const { finalScore, availablePoints, selectionLift, penaltyApplied, penaltyReason } = breakdown;
  const isInvisible = finalScore < 30;
  const color = scoreColor(finalScore);
  const label = scoreLabel(finalScore);

  const [rewriteState, setRewriteState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [rewriteResult, setRewriteResult] = useState<RewriteResult | null>(null);

  async function handleRewrite() {
    setRewriteState("loading");
    try {
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId }),
      });
      const data = await res.json() as RewriteResult & { error?: string };
      if (!res.ok || data.error) {
        setRewriteState("error");
        return;
      }
      setRewriteResult(data);
      setRewriteState("done");
    } catch {
      setRewriteState("error");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-8">
      {/* URL */}
      <p className="mb-6 truncate text-sm text-muted-foreground" title={url}>
        {url}
      </p>

      <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
        {/* Score display */}
        <div className="flex flex-col items-center gap-2 text-center">
          {isInvisible && (
            <Unlink className="h-8 w-8 text-red-500 mb-1" aria-label="Agent likely invisible to orchestrators" />
          )}
          <div className={`text-8xl font-bold tabular-nums ${color}`}>
            {finalScore}
          </div>
          <div className="text-sm text-muted-foreground">
            out of{" "}
            <span className="font-medium text-foreground">{availablePoints} pts</span>
            {" "}available
          </div>
          <Badge variant={scoreBadgeVariant(finalScore)} className="text-sm px-3 py-1">
            {label}
          </Badge>
        </div>

        {/* Stats */}
        <div className="flex-1 space-y-4">
          {/* Lift */}
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="text-xs text-muted-foreground mb-1">Selection Probability Lift</p>
            <p className={`text-3xl font-bold ${color}`}>
              {selectionLift.toFixed(1)}×
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              vs baseline orchestrator selection
            </p>
            <p className="text-xs text-muted-foreground/60 mt-2">
              ⚠ Provisional estimate — calibrated with real orchestrator data in Phase 2.
            </p>
          </div>

          {/* Phase 1 ceiling note */}
          <div className="flex items-start gap-2 rounded-lg border border-border bg-background p-3">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <p className="text-xs text-muted-foreground">
              Full 100 pts available in Phase 2 with live probe enabled. Currently{" "}
              <span className="text-foreground font-medium">{availablePoints} pts</span> max —
              Reliability probe adds 18 pts when activated.
            </p>
          </div>

          {/* Penalty warning */}
          {penaltyApplied && penaltyReason && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <span className="text-red-400 text-sm font-semibold">Penalty applied:</span>
              <p className="text-xs text-red-400">{penaltyReason}</p>
            </div>
          )}

          {/* Rewrite button */}
          <button
            onClick={handleRewrite}
            disabled={rewriteState === "loading" || rewriteState === "done"}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {rewriteState === "loading" ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Analyzing with AI…</>
            ) : (
              <><Sparkles className="h-4 w-4" />Rewrite with AI</>
            )}
          </button>

          {rewriteState === "error" && (
            <p className="text-xs text-destructive text-center">Rewrite failed — please try again.</p>
          )}
        </div>
      </div>

      {/* Rewrite suggestions panel */}
      {rewriteState === "done" && rewriteResult && (
        <div className="mt-8 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">AI Suggestions</h3>
            {rewriteResult.projectedPointsGained > 0 && (
              <span className="text-xs text-green-400 font-medium">
                Est. +{rewriteResult.projectedPointsGained} pts if applied
              </span>
            )}
          </div>
          {rewriteResult.suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No improvements suggested — this tool is well-optimised for the scoreable criteria.
            </p>
          ) : (
            <div className="space-y-3">
              {rewriteResult.suggestions.map((s, i) => (
                <SuggestionRow key={i} s={s} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* "Invisible" visual for very low scores */}
      {isInvisible && (
        <div className="mt-8 rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-center">
          <p className="text-sm font-medium text-red-400 mb-1">
            Your agent is effectively invisible to AI orchestrators.
          </p>
          <p className="text-xs text-muted-foreground">
            When an orchestrator scans 26,000+ available tools, yours won&apos;t make the shortlist.
            Fix the lowest-scoring layer first — even a 15-point improvement can change that.
          </p>
          <div className="mt-4 mx-auto max-w-xs rounded border border-border bg-card/50 p-3 blur-sm select-none" aria-hidden>
            <div className="h-2 w-24 rounded bg-muted mb-2" />
            <div className="h-1.5 w-40 rounded bg-muted/60 mb-1" />
            <div className="h-1.5 w-32 rounded bg-muted/40" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground/60">
            This is how orchestrators see your agent right now.
          </p>
        </div>
      )}
    </div>
  );
}
