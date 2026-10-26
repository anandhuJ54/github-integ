import { useState } from "react";
import { cn } from "@v3/shared/components/utils/utils";
import { us10Display } from "@v3/shared/components/utils/us-phone";

/* ─────────────────────────── identity primitives ─────────────────────────── */

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** Soft, brand-tinted initials disc used whenever a photo or logo is missing. */
export function Monogram({
  name,
  className,
  square = false,
  style,
}: {
  name: string;
  className?: string;
  square?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center border border-[color:var(--color-hairline)] font-semibold tracking-tight text-[color:var(--color-g-blue)]",
        square ? "rounded-lg" : "rounded-[50%]",
        className,
      )}
      style={{
        backgroundImage:
          "linear-gradient(140deg, var(--color-g-blue-soft) 0%, var(--color-g-purple-soft) 100%)",
        ...style,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

/**
 * Entity avatar with graceful fallback.
 * Professionals get a circle, places and brands a rounded square with contained logo.
 */
export function EntityAvatar({
  name,
  src,
  kind = "professional",
  size = 56,
  className,
  eager = false,
}: {
  name: string;
  src?: string | null;
  kind?: "professional" | "location" | "brand";
  size?: number;
  className?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const round = kind === "professional";
  const box = { height: size, width: size, fontSize: Math.round(size * 0.34) };
  /* Images that already failed before hydration never fire onError, so check the
     decoded size on mount too — otherwise the browser shows raw alt text. */
  const check = (el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  };
  if (!src || failed) {
    return (
      <Monogram
        name={name}
        square={!round}
        className={cn("shadow-[0_1px_2px_rgba(15,23,42,0.06)]", className)}
        style={box}
      />
    );
  }
  return (
    <img
      key={src}
      ref={check}
      src={src}
      alt={name}
      loading={eager ? "eager" : "lazy"}
      onError={() => setFailed(true)}
      style={box}
      className={cn(
        "shrink-0 overflow-hidden border border-[color:var(--color-hairline)] bg-white text-[0px] shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
        round ? "rounded-[50%] object-cover" : "rounded-lg object-contain p-1",
        className,
      )}
    />
  );
}

/**
 * Presentational phone formatting only — some sources store the number as a
 * JSON array string. Never invent digits; just display what is stored cleanly.
 */
export function displayPhone(raw: string | null | undefined): { text: string; href: string } | null {
  if (!raw) return null;
  let v = String(raw).trim();
  if (v.startsWith("[")) {
    try {
      const arr = JSON.parse(v) as unknown;
      if (Array.isArray(arr) && arr.length > 0) v = String(arr[0]);
    } catch {
      v = v.replace(/[[\]"']/g, "").split(",")[0]!.trim();
    }
  }
  v = v.replace(/^["']|["']$/g, "").trim();
  if (!v) return null;
  // Fix (10-digit US phone, 2026-10-13): our ETL sources store 10 digits -> "(860) 570-4059", tel:+18605704059.
  const us = us10Display(v);
  if (us) return { text: us, href: `tel:+1${v.replace(/\D/g, "").slice(-10)}` };
  const digits = v.replace(/[^\d+]/g, "");
  return { text: v, href: `tel:${digits}` };
}

/* ───────────────────────────── score visuals ───────────────────────────── */

const SCORE_MAX = 850;

function scoreTone(pct: number) {
  if (pct >= 0.75) return { from: "#34a853", to: "#4285f4" };
  if (pct >= 0.5) return { from: "#4285f4", to: "#9b72f2" };
  return { from: "#fbbc04", to: "#ea4335" };
}

/**
 * Compact full-circle Search Rank Score ring.
 * Purely presentational — the value is whatever the caller read from the DB.
 */
export function ScoreRing({
  score,
  size = 96,
  stroke,
  label = "Search Rank",
  showMax = true,
  className,
}: {
  score: number | null;
  size?: number;
  stroke?: number;
  label?: string | null;
  showMax?: boolean;
  className?: string;
}) {
  const w = stroke ?? Math.max(5, Math.round(size * 0.085));
  const r = (size - w) / 2;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(1, score / SCORE_MAX));
  const tone = scoreTone(pct);
  const gid = `ring-${Math.round(pct * 1000)}-${size}`;
  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={tone.from} />
            <stop offset="100%" stopColor={tone.to} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth={w} />
        {score === null ? null : (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#${gid})`}
            strokeWidth={w}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">
        <div>
          <div
            className="font-semibold tabular-nums tracking-tight text-ink"
            style={{ fontSize: Math.round(size * 0.3) }}
          >
            {score === null ? "—" : score}
          </div>
          {showMax ? (
            <div
              className="mt-0.5 text-[color:var(--color-ink-3)]"
              style={{ fontSize: Math.max(9, Math.round(size * 0.1)) }}
            >
              / {SCORE_MAX}
            </div>
          ) : null}
        </div>
      </div>
      {label ? (
        <span className="sr-only">
          {label} {score ?? "unavailable"}
        </span>
      ) : null}
    </div>
  );
}

/** Inline score pill used in dense lists (SERP cards). */
export function ScoreBadge({ score, className }: { score: number | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-[color:var(--color-hairline)] bg-white py-1 pl-1 pr-3",
        className,
      )}
    >
      <ScoreRing score={score} size={26} stroke={3} showMax={false} label="Search Rank" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-3)]">
        Search Rank
      </span>
    </span>
  );
}

/* ──────────────────────────────── skeletons ──────────────────────────────── */

export function Shimmer({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-[color:var(--color-surface-3)]", className)} />;
}

export function ProfileSkeleton() {
  return (
    <div className="min-h-screen bg-[color:var(--color-surface-2)]">
      <div className="border-b border-[color:var(--color-hairline)] bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-6 md:flex-row md:items-center">
          <Shimmer className="h-24 w-24 rounded-full" />
          <div className="flex-1 space-y-3">
            <Shimmer className="h-8 w-3/5" />
            <Shimmer className="h-4 w-2/5" />
            <Shimmer className="h-4 w-1/4" />
          </div>
          <Shimmer className="h-24 w-24 rounded-full" />
        </div>
      </div>
      <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-6">
        {[0, 1, 2].map((i) => (
          <Shimmer key={i} className="h-40 w-full rounded-3xl" />
        ))}
      </div>
    </div>
  );
}

export function ResultsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-3xl border border-[color:var(--color-hairline)] bg-white p-5"
        >
          <div className="flex gap-4">
            <Shimmer className="h-14 w-14 rounded-full" />
            <div className="flex-1 space-y-2.5">
              <Shimmer className="h-5 w-2/5" />
              <Shimmer className="h-3.5 w-3/5" />
              <Shimmer className="h-3.5 w-1/4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
