export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  centerLabel?: string;
  centerValue?: string;
  size?: number;
}

export function DonutChart({
  segments,
  centerLabel,
  centerValue,
  size = 180,
}: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const radius = 15.915; // 100/(2π) → circumference = 100
  const gap = 0.015;

  const arcs = segments
    .filter((s) => s.value > 0)
    .reduce<Array<DonutSegment & { dash: number; offset: number }>>((acc, segment) => {
      const fraction = total > 0 ? segment.value / total : 0;
      const previous = acc[acc.length - 1];
      const offset = (previous ? previous.offset + (previous.dash + gap) : 0) + gap / 2;
      return [
        ...acc,
        {
          ...segment,
          dash: Math.max(0, fraction - gap),
          offset,
        },
      ];
    }, []);

  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90">
          <circle cx="21" cy="21" r={radius} fill="none" stroke="#1f2127" strokeWidth="4.5" />
          {arcs.map((arc, i) => (
            <circle
              key={i}
              cx="21"
              cy="21"
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth="4.5"
              strokeDasharray={`${arc.dash} ${1 - arc.dash}`}
              strokeDashoffset={-arc.offset}
              strokeLinecap="round"
              style={{ transition: "stroke-dasharray 0.4s ease" }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {centerValue && (
            <span className="text-lg font-bold tracking-tight text-zinc-50 tabular-nums">
              {centerValue}
            </span>
          )}
          {centerLabel && (
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              {centerLabel}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {segments.map((segment) => (
          <div key={segment.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: segment.color }} />
            <span className="text-zinc-400">{segment.label}</span>
            <span className="ml-auto pl-4 font-medium text-zinc-200 tabular-nums">
              {total > 0 ? Math.round((segment.value / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
