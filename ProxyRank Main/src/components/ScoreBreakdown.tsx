"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AuditBreakdown, CLISchemaDetail } from "@/lib/types";
import { SCORING_WEIGHTS } from "@/lib/constants";

interface ScoreBreakdownProps {
  breakdown: AuditBreakdown;
}

function LayerBar({ value, max }: { value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  const color =
    pct >= 70 ? "bg-green-400" : pct >= 40 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function LayerRow({
  title,
  pts,
  max,
  children,
}: {
  title: string;
  pts: number;
  max: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pct = Math.round((pts / max) * 100);
  const color =
    pct >= 70 ? "text-green-400" : pct >= 40 ? "text-yellow-400" : "text-red-400";

  return (
    <div className="rounded-lg border border-border bg-background">
      <button
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold ${color}`}>
            {pts} / {max}
          </span>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>
      <LayerBar value={pts} max={max} />
      {open && (
        <div className="border-t border-border px-4 py-4 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}

function SubRow({ label, pts, max }: { label: string; pts: number; max: number }) {
  const pct = Math.round((pts / max) * 100);
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${pct >= 70 ? "text-green-400" : pct >= 40 ? "text-yellow-400" : "text-red-400"}`}>
        {pts} / {max}
      </span>
    </div>
  );
}

export function ScoreBreakdown({ breakdown }: ScoreBreakdownProps) {
  const { details, layers } = breakdown;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Layer Breakdown
      </h2>

      {/* Layer 1: Semantic */}
      <LayerRow title="Layer 1 — Semantic Discovery" pts={layers.semantic} max={SCORING_WEIGHTS.semantic}>
        <SubRow label="Tool name quality" pts={details.semantic.toolNameScore} max={8} />
        <SubRow label="Description quality" pts={details.semantic.descriptionScore} max={12} />
        <SubRow label="Intent alignment" pts={details.semantic.intentAlignmentScore} max={10} />
        <SubRow label="Token efficiency" pts={details.semantic.tokenEfficiencyScore} max={5} />
        {details.semantic.topMatchedIntents.length > 0 && (
          <div className="pt-1">
            <p className="text-xs text-muted-foreground mb-1">Top matched intents:</p>
            <div className="flex flex-wrap gap-1">
              {details.semantic.topMatchedIntents.map((intent) => (
                <Badge key={intent} variant="outline" className="text-xs">
                  {intent}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </LayerRow>

      {/* Layer 2: Schema (MCP) or Interface (CLI) */}
      {breakdown.mode === "cli" ? (
        <LayerRow title="Layer 2 — Interface Hygiene" pts={layers.schema} max={SCORING_WEIGHTS.schema}>
          <SubRow label="JSON / structured output flag" pts={(details.schema as unknown as CLISchemaDetail).jsonOutputScore} max={10} />
          <SubRow label="Non-interactive / CI mode flag" pts={(details.schema as unknown as CLISchemaDetail).nonInteractiveScore} max={8} />
          <SubRow label="Subcommands documented" pts={(details.schema as unknown as CLISchemaDetail).subcommandScore} max={7} />
          <SubRow label="--help flag present" pts={(details.schema as unknown as CLISchemaDetail).helpFlagScore} max={5} />
        </LayerRow>
      ) : (
        <LayerRow title="Layer 2 — Schema & Interface" pts={layers.schema} max={SCORING_WEIGHTS.schema}>
          <SubRow label="Parameter strict types" pts={details.schema.paramTypesScore} max={10} />
          <SubRow label="Parameter descriptions" pts={details.schema.paramDescriptionsScore} max={8} />
          <SubRow label="Required / optional / defaults" pts={details.schema.requiredDefaultsScore} max={5} />
          <SubRow label="Output schema" pts={details.schema.outputSchemaScore} max={7} />
        </LayerRow>
      )}

      {/* Layer 3: Reliability */}
      <LayerRow title="Layer 3 — Reliability & Performance" pts={layers.reliability} max={SCORING_WEIGHTS.reliability}>
        <div className="flex items-center gap-2 rounded-md bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 mb-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />
          <p className="text-xs text-yellow-400">
            Live probe not run — Reliability score reflects manifest data only.
            18 pts unlock in Phase 2.
          </p>
        </div>
        <SubRow label="Latency p95 &lt; 450ms" pts={0} max={10} />
        <SubRow label="Success rate &gt; 96%" pts={0} max={8} />
        <SubRow label="Response token efficiency" pts={details.reliability.responseTokensScore} max={4} />
        <SubRow label="Async / continuation support" pts={details.reliability.asyncSupportScore} max={3} />
      </LayerRow>

      {/* Layer 4: Governance */}
      <LayerRow title="Layer 4 — Governance & Authority" pts={layers.governance} max={SCORING_WEIGHTS.governance}>
        <SubRow label="Cryptographic manifest signature" pts={details.governance.signatureScore} max={4} />
        <SubRow label="Registry listings (≥ 2)" pts={details.governance.registryScore} max={3} />
        <SubRow label="Domain verification" pts={details.governance.domainScore} max={3} />
      </LayerRow>
    </div>
  );
}
