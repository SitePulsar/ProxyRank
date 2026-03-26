import type { LayerScores } from "@/lib/types";
import { SCORING_WEIGHTS } from "@/lib/constants";

interface Benchmark {
  id: string;
  label: string;
  score: number;
  breakdown: { layers: LayerScores };
}

interface GoldStandardComparisonProps {
  userScore: number;
  userLayers: LayerScores;
  benchmarks: Benchmark[];
}

function pct(val: number, max: number) {
  return Math.round((val / max) * 100);
}

function scoreColor(score: number) {
  if (score >= 70) return "text-green-400";
  if (score >= 40) return "text-yellow-400";
  return "text-red-400";
}

export function GoldStandardComparison({
  userScore,
  userLayers,
  benchmarks,
}: GoldStandardComparisonProps) {
  const rows = [
    { label: "Overall", userVal: userScore, max: 100, isOverall: true },
    { label: "Semantic", userVal: pct(userLayers.semantic, SCORING_WEIGHTS.semantic), max: 100 },
    { label: "Schema", userVal: pct(userLayers.schema, SCORING_WEIGHTS.schema), max: 100 },
    { label: "Reliability", userVal: pct(userLayers.reliability, SCORING_WEIGHTS.reliability), max: 100 },
    { label: "Governance", userVal: pct(userLayers.governance, SCORING_WEIGHTS.governance), max: 100 },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        vs. Industry Leaders
      </h2>
      <p className="mb-5 text-xs text-muted-foreground">
        How your agent compares to well-known MCP implementations (all layers normalized to 0–100).
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 pr-4 text-left text-xs font-medium text-muted-foreground">Layer</th>
              <th className="py-2 px-3 text-center text-xs font-medium text-primary">Your Agent</th>
              {benchmarks.map((b) => (
                <th key={b.id} className="py-2 px-3 text-center text-xs font-medium text-muted-foreground">
                  {b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, userVal, isOverall }) => (
              <tr key={label} className={`border-b border-border/50 ${isOverall ? "font-semibold" : ""}`}>
                <td className="py-2 pr-4 text-muted-foreground text-xs">{label}</td>
                <td className={`py-2 px-3 text-center tabular-nums ${scoreColor(userVal)}`}>
                  {userVal}
                </td>
                {benchmarks.map((b) => {
                  const bVal = isOverall
                    ? b.score
                    : label === "Semantic"
                    ? pct(b.breakdown.layers.semantic, SCORING_WEIGHTS.semantic)
                    : label === "Schema"
                    ? pct(b.breakdown.layers.schema, SCORING_WEIGHTS.schema)
                    : label === "Reliability"
                    ? pct(b.breakdown.layers.reliability, SCORING_WEIGHTS.reliability)
                    : pct(b.breakdown.layers.governance, SCORING_WEIGHTS.governance);

                  return (
                    <td key={b.id} className={`py-2 px-3 text-center tabular-nums ${scoreColor(bVal)}`}>
                      {bVal}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
