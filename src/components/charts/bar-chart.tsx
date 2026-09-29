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
            {/* Solid 1px hairline grid — editorial, no dashes */}
            <line
              x1="0"
              x2={width}
              y1={padTop + f * innerHeight}
              y2={padTop + f * innerHeight}
              stroke="#ffffff"
              strokeOpacity="0.14"
              strokeWidth="1"
            />
            <text
              x={width - 4}
              y={padTop + f * innerHeight - 4}
              textAnchor="end"
              fontSize="9"
              fill="#71717a"
              className="font-mono tabular-nums"
            >
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
                    rx="0"
                    fill={s.color}
                    opacity={hover === null || hover === i ? 1 : 0.3}
                    onMouseEnter={() => setHover(i)}
                    style={{ transition: "opacity 0.1s" }}
                  />
                );
              })}
              <text
                x={x}
                y={height - 8}
                textAnchor="middle"
                fontSize="9"
                fill={hover === i ? "#ffffff" : "#71717a"}
                fontWeight={hover === i ? 700 : 400}
                className="font-mono uppercase"
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      {hover !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 border border-white bg-black px-3 py-2 text-xs shadow-[4px_4px_0_0_#ff3b00]">
          <span className="type-kicker text-zinc-400">{labels[hover]}</span>
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0" style={{ background: s.color }} />
              <span className="type-kicker text-zinc-400">{s.name}</span>
              <span className="font-bold text-white tabular-nums">
                {formatCompactCurrency(s.values[hover] ?? 0, currency)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
