"use client";

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from "recharts";
import type { LayerScores } from "@/lib/types";
import { SCORING_WEIGHTS } from "@/lib/constants";

interface ProxyRadarChartProps {
  layers: LayerScores;
}

// Normalize each layer to 0–100 for fair visual comparison
// (layers have unequal raw maxima: 35, 30, 25, 10)
function normalizeLayer(value: number, max: number): number {
  return Math.round((value / max) * 100);
}

export function ProxyRadarChart({ layers }: ProxyRadarChartProps) {
  const data = [
    {
      subject: "Semantic",
      value: normalizeLayer(layers.semantic, SCORING_WEIGHTS.semantic),
      fullMark: 100,
    },
    {
      subject: "Schema",
      value: normalizeLayer(layers.schema, SCORING_WEIGHTS.schema),
      fullMark: 100,
    },
    {
      subject: "Reliability",
      value: normalizeLayer(layers.reliability, SCORING_WEIGHTS.reliability),
      fullMark: 100,
    },
    {
      subject: "Governance",
      value: normalizeLayer(layers.governance, SCORING_WEIGHTS.governance),
      fullMark: 100,
    },
  ];

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
          <PolarGrid stroke="oklch(0.25 0.015 264.376)" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: "oklch(0.65 0.028 264.376)", fontSize: 12 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: "oklch(0.65 0.028 264.376)", fontSize: 10 }}
            tickCount={4}
          />
          <Radar
            name="ProxyScore"
            dataKey="value"
            stroke="oklch(0.568 0.243 264.376)"
            fill="oklch(0.568 0.243 264.376)"
            fillOpacity={0.25}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
