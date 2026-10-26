import { useEffect, useState } from "react";
import { AnimatedNumber } from "./animated-number";

/** 850-point Search Rank Score gauge with animated Gemini-ribbon stroke. */
export function ScoreGauge({
  score,
  max = 850,
  size = 220,
  label = "Search Rank Score",
  delta,
}: {
  score: number;
  max?: number;
  size?: number;
  label?: string;
  delta?: number | null;
}) {
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setAnimated(score), 60);
    return () => clearTimeout(id);
  }, [score]);

  const stroke = 14;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = -210;
  const endAngle = 30;
  const totalArc = endAngle - startAngle; // 240
  const pct = Math.max(0, Math.min(1, animated / max));
  const sweep = totalArc * pct;

  const polar = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };
  const [bx, by] = polar(startAngle);
  const [ex, ey] = polar(startAngle + totalArc);
  const [fx, fy] = polar(startAngle + sweep);
  const trackPath = `M ${bx} ${by} A ${r} ${r} 0 1 1 ${ex} ${ey}`;
  const fillPath = `M ${bx} ${by} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${fx} ${fy}`;

  return (
    <div className="relative inline-flex flex-col items-center">
      <svg width={size} height={size} className="overflow-visible">
        <defs>
          <linearGradient id="srs-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4285f4" />
            <stop offset="35%" stopColor="#9b72f2" />
            <stop offset="65%" stopColor="#ea4335" />
            <stop offset="100%" stopColor="#fbbc04" />
          </linearGradient>
        </defs>
        <path
          d={trackPath}
          fill="none"
          stroke="#f1f3f4"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={fillPath}
          fill="none"
          stroke="url(#srs-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          style={{
            transition: "all 1.4s cubic-bezier(.2,.8,.2,1)",
            filter: "drop-shadow(0 4px 12px rgba(66,133,244,0.28))",
          }}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <AnimatedNumber
          value={score}
          duration={1400}
          className="text-5xl font-bold tracking-tight text-ink"
        />
        <div className="mt-1 text-xs uppercase tracking-widest text-[color:var(--color-ink-2)]">
          {label}
        </div>
        <div className="mt-1 text-[11px] text-[color:var(--color-ink-3)]">
          of {max.toLocaleString()}
        </div>
        {typeof delta === "number" && delta !== 0 && (
          <div
            className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: delta > 0 ? "var(--color-g-green-soft)" : "var(--color-g-red-soft)",
              color: delta > 0 ? "#137333" : "#c5221f",
            }}
          >
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
          </div>
        )}
      </div>
    </div>
  );
}
