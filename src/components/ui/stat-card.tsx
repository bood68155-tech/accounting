import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: string;
  sublabel?: string;
  delta?: number; // percent change vs previous period
  icon?: ReactNode;
  spark?: number[];
  accent?: string;
  invert?: boolean;
}

export function StatCard({
  label,
  value,
  sublabel,
  delta,
  icon,
  spark,
  invert,
}: StatCardProps) {
  const positive = (delta ?? 0) >= 0;
  const showDelta = delta !== undefined;

  return (
    <div className="group relative border border-white bg-black p-5 transition-colors duration-100 hover:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="type-kicker text-zinc-500">{label}</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-white tabular-nums sm:text-3xl">
            {value}
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs">
            {showDelta && (
              <span
                className={cn(
                  "px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]",
                  invert
                    ? positive
                      ? "bg-red-500 text-white"
                      : "bg-emerald-500 text-black"
                    : positive
                      ? "bg-accent text-white"
                      : "bg-red-500 text-white",
                )}
              >
                {positive ? "▲" : "▼"} {Math.abs(delta!).toFixed(1)}%
              </span>
            )}
            {sublabel && <span className="text-zinc-500">{sublabel}</span>}
          </div>
        </div>
        {icon && <div className="frame-icon h-10 w-10 shrink-0">{icon}</div>}
      </div>
      {spark && spark.length > 0 && (
        <div className="mt-4 flex h-8 items-end gap-0.5">
          {spark.map((v, i) => {
            const max = Math.max(...spark);
            const min = Math.min(...spark);
            const range = Math.max(1, max - min);
            const h = 15 + Math.round(((v - min) / range) * 85); // 15–100%
            return (
              <div
                key={i}
                className={cn("flex-1", i === spark.length - 1 ? "bg-white" : "bg-accent")}
                style={{ height: `${h}%` }}
              />
            );
          })}
        </div>
      )}
      {/* Solid red hover rule along the top edge */}
      <span className="pointer-events-none absolute left-0 top-0 h-0.5 w-0 bg-accent transition-all duration-150 group-hover:w-full" />
    </div>
  );
}
