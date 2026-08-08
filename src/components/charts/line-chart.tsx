"use client";

import { useMemo, useRef, useState } from "react";
import { formatCompactCurrency } from "@/lib/utils";

export interface LineSeries {
  name: string;
  color: string;
  data: number[];
}

interface LineChartProps {
  labels: string[];
  series: LineSeries[];
  height?: number;
  currency?: string;
}

export function LineChart({ labels, series, height = 260, currency = "USD" }: LineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const width = 600;
  const padX = 8;
  const padTop = 18;
  const padBottom = 26;

  const { max, min } = useMemo(() => {
    const values = series.flatMap((s) => s.data);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = max - min;
    return { max: max + span * 0.12, min: min - span * 0.06 };
  }, [series]);

  const innerHeight = height - padTop - padBottom;
  const innerWidth = width - padX * 2;
  const range = max - min || 1;

  const x = (i: number) => padX + (i / Math.max(1, labels.length - 1)) * innerWidth;
  const y = (v: number) => padTop + ((max - v) / range) * innerHeight;

  const gridLines = [0.25, 0.5, 0.75].map((f) => ({
    y: padTop + f * innerHeight,
    value: max - f * range,
  }));

  const pointAt = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relative = ((clientX - rect.left) / rect.width) * width;
    const index = Math.round(((relative - padX) / innerWidth) * (labels.length - 1));
    setHoverIndex(Math.max(0, Math.min(labels.length - 1, index)));
  };

  return (
    <div className="relative w-full" onMouseLeave={() => setHoverIndex(null)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        onMouseMove={(e) => pointAt(e.clientX)}
      >
        {gridLines.map((line, i) => (
          <g key={i}>
            <line x1={padX} x2={width - padX} y1={line.y} y2={line.y} stroke="#27272a" strokeWidth="1" strokeDasharray="3 4" />
            <text x={width - padX} y={line.y - 4} textAnchor="end" fontSize="9" fill="#52525b" className="tabular-nums">
              {formatCompactCurrency(line.value, currency)}
            </text>
          </g>
        ))}

        {labels.map((label, i) => (
          <text
            key={label}
            x={x(i)}
            y={height - 8}
            textAnchor="middle"
            fontSize="9"
            fill={hoverIndex === i ? "#d4d4d8" : "#52525b"}
            fontWeight={hoverIndex === i ? 600 : 400}
          >
            {label}
          </text>
        ))}

        {series.map((s) => (
          <g key={s.name}>
            <path
              d={s.data
                .map((value, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(value)}`)
                .join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={hoverIndex === null ? 1 : 0.35}
            />
            {s.data.map((value, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(value)}
                r="3.5"
                fill={s.color}
                opacity={hoverIndex === i ? 1 : 0}
                style={{ transition: "opacity 0.15s" }}
              />
            ))}
          </g>
        ))}

        {hoverIndex !== null && (
          <line
            x1={x(hoverIndex)}
            x2={x(hoverIndex)}
            y1={padTop}
            y2={height - padBottom}
            stroke="#3f3f46"
            strokeWidth="1"
          />
        )}
      </svg>

      {hoverIndex !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-xs shadow-xl"
          style={{ left: `${(x(hoverIndex) / width) * 100}%`, transform: "translateX(-50%)" }}
        >
          <div className="mb-1 font-semibold text-zinc-300">{labels[hoverIndex]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-2 py-0.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="text-zinc-400">{s.name}</span>
              <span className="ml-auto pl-3 font-medium text-zinc-100 tabular-nums">
                {formatCompactCurrency(s.data[hoverIndex] ?? 0, currency)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
