"use client";

import { useState } from "react";
import { formatCompactCurrency } from "@/lib/utils";

export interface BarSeries {
  name: string;
  color: string;
  values: number[];
}

interface BarChartProps {
  labels: string[];
  series: BarSeries[];
  height?: number;
  currency?: string;
}

export function BarChart({ labels, series, height = 220, currency = "USD" }: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 560;
  const padTop = 16;
  const padBottom = 24;

  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const innerHeight = height - padTop - padBottom;
  const groupWidth = width / Math.max(1, labels.length);
  const barWidth = Math.min(26, (groupWidth * 0.55) / series.length);

  return (
    <div className="w-full" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {[0.25, 0.5, 0.75].map((f, i) => (
          <g key={i}>
            <line
              x1="0"
              x2={width}
              y1={padTop + f * innerHeight}
              y2={padTop + f * innerHeight}
              stroke="#27272a"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
            <text x={width - 4} y={padTop + f * innerHeight - 4} textAnchor="end" fontSize="9" fill="#52525b">
              {formatCompactCurrency(max * (1 - f), currency)}
            </text>
          </g>
        ))}

        {labels.map((label, i) => {
          const x = i * groupWidth + groupWidth / 2;
          return (
            <g key={label}>
              {series.map((s, si) => {
                const barHeight = (s.values[i] / max) * innerHeight;
                return (
                  <rect
                    key={s.name}
                    x={x - (series.length * barWidth) / 2 + si * barWidth + 2}
                    y={padTop + innerHeight - barHeight}
                    width={barWidth - 4}
                    height={Math.max(1, barHeight)}
                    rx="3"
                    fill={s.color}
                    opacity={hover === null || hover === i ? 1 : 0.35}
                    onMouseEnter={() => setHover(i)}
                    style={{ transition: "opacity 0.15s" }}
                  />
                );
              })}
              <text
                x={x}
                y={height - 8}
                textAnchor="middle"
                fontSize="9"
                fill={hover === i ? "#d4d4d8" : "#52525b"}
                fontWeight={hover === i ? 600 : 400}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      {hover !== null && (
        <div className="mt-1 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 py-2 text-xs">
          <span className="font-semibold text-zinc-300">{labels[hover]}</span>
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5 text-zinc-400">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.name}:{" "}
              <span className="font-medium text-zinc-100 tabular-nums">
                {formatCompactCurrency(s.values[hover] ?? 0, currency)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
