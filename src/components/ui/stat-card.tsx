import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/charts/sparkline";
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
  accent = "#34d399",
  invert,
}: StatCardProps) {
  const positive = (delta ?? 0) >= 0;
  const showDelta = delta !== undefined;

  return (
    <Card className="group relative overflow-hidden p-5 transition-colors hover:border-zinc-700">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-zinc-50 tabular-nums">
            {value}
          </p>
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            {showDelta && (
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 font-medium",
                  invert
                    ? positive
                      ? "bg-red-500/10 text-red-400"
                      : "bg-emerald-500/10 text-emerald-400"
                    : positive
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-red-500/10 text-red-400",
                )}
              >
                {positive ? "▲" : "▼"} {Math.abs(delta!).toFixed(1)}%
              </span>
            )}
            {sublabel && <span className="text-zinc-500">{sublabel}</span>}
          </div>
        </div>
        {icon && (
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
            style={{ borderColor: `${accent}33`, background: `${accent}14`, color: accent }}
          >
            {icon}
          </div>
        )}
      </div>
      {spark && (
        <div className="mt-3 -mb-1">
          <Sparkline data={spark} stroke={accent} />
        </div>
      )}
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `${accent}22` }}
      />
    </Card>
  );
}
