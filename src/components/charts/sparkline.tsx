interface SparklineProps {
  data: number[];
  className?: string;
  stroke?: string;
  fill?: boolean;
}

export function Sparkline({
  data,
  className = "h-10 w-full",
  stroke = "#34d399",
  fill = true,
}: SparklineProps) {
  if (data.length < 2) return <div className={className} />;

  const width = 120;
  const height = 36;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 3;

  const points = data.map((value, i) => {
    const x = (i / (data.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${pad},${height} ${line} ${width - pad},${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      {fill && (
        <polygon points={area} fill={stroke} opacity={0.08} stroke="none" />
      )}
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
