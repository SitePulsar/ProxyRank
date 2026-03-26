"use client";

import { assessPersonas } from "@/lib/personas";
import type { LayerScores } from "@/lib/types";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";

interface OrchestratorSimulationProps {
  layers: LayerScores;
}

function ScoreArc({ score }: { score: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  const color = score >= 58 ? "#4ade80" : score >= 45 ? "#facc15" : "#f87171";

  return (
    <svg width="72" height="72" viewBox="0 0 72 72" className="shrink-0">
      <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/20" />
      <circle
        cx="36" cy="36" r={r} fill="none"
        stroke={color} strokeWidth="5"
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="40" textAnchor="middle" fontSize="14" fontWeight="bold" fill={color}>
        {score}
      </text>
    </svg>
  );
}

function VerdictIcon({ verdict }: { verdict: "Selects" | "Borderline" | "Rejects" }) {
  if (verdict === "Selects") return <CheckCircle2 className="h-4 w-4 text-green-400" />;
  if (verdict === "Borderline") return <AlertCircle className="h-4 w-4 text-yellow-400" />;
  return <XCircle className="h-4 w-4 text-red-400" />;
}

function verdictColor(verdict: "Selects" | "Borderline" | "Rejects") {
  if (verdict === "Selects") return "text-green-400";
  if (verdict === "Borderline") return "text-yellow-400";
  return "text-red-400";
}

export function OrchestratorSimulation({ layers }: OrchestratorSimulationProps) {
  const assessments = assessPersonas(layers);
  const selectCount = assessments.filter((a) => a.verdict === "Selects").length;

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Orchestrator Simulation
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            How 4 major AI orchestrators evaluate your agent
          </p>
        </div>
        <div className="text-right">
          <span className={`text-2xl font-bold ${selectCount >= 3 ? "text-green-400" : selectCount >= 2 ? "text-yellow-400" : "text-red-400"}`}>
            {selectCount}/4
          </span>
          <p className="text-xs text-muted-foreground">would select</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {assessments.map((a) => (
          <div
            key={a.persona.id}
            className="rounded-lg border border-border bg-background p-4 space-y-3"
          >
            {/* Header */}
            <div className="flex items-start gap-3">
              <ScoreArc score={a.score} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <VerdictIcon verdict={a.verdict} />
                  <span className={`text-xs font-semibold ${verdictColor(a.verdict)}`}>
                    {a.verdict}
                  </span>
                </div>
                <p className="text-sm font-semibold text-foreground">{a.persona.name}</p>
                <p className="text-xs text-muted-foreground">{a.persona.tagline}</p>
              </div>
            </div>

            {/* Reasoning */}
            <div className="space-y-2 text-xs">
              <div className="flex gap-2">
                <span className="text-green-400 shrink-0 font-medium">↑</span>
                <span className="text-muted-foreground">{a.strength}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-red-400 shrink-0 font-medium">↓</span>
                <span className="text-muted-foreground">{a.weakness}</span>
              </div>
            </div>

            {/* Fix */}
            <div className="rounded border border-primary/20 bg-primary/5 px-3 py-2">
              <p className="text-xs text-primary">
                <span className="font-semibold">Fix: </span>{a.fixFirst}
              </p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground/60 text-center">
        ⚠ Simulated thresholds — based on documented selection criteria, not live orchestrator calls.
      </p>
    </div>
  );
}
