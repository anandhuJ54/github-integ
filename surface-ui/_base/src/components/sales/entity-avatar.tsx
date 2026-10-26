import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@v3/ui/components/ui/avatar";
import { cn } from "@v3/ui/lib/utils";

/* ────────────────────────────────────────────────────────────
   Circular identity images used across Growth Hub.
   Every people/entity row gets one; a null photo/logo falls
   back to deterministic initials so rows never look broken.
   ──────────────────────────────────────────────────────────── */

const SIZES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-[13px]",
  lg: "h-12 w-12 text-[15px]",
  xl: "h-16 w-16 text-[19px]",
} as const;

export type AvatarSize = keyof typeof SIZES;

/** Six soft tints so fallbacks read as a set, not as errors. */
const TINTS = [
  "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
  "bg-[color:var(--color-g-yellow-soft)] text-[#b06000]",
  "bg-[color:var(--color-g-purple-soft)] text-[#7b4ce0]",
  "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
  "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
];

function tintFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 997;
  return TINTS[h % TINTS.length];
}

export function initialsFor(name: string | null | undefined) {
  const clean = (name ?? "").replace(/\((?:demo|Demo)\)/g, "").trim();
  if (!clean) return "—";
  const parts = clean.split(/[\s/·,]+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** Person avatar — circular, subtle ring, initials fallback. */
export function PersonAvatar({
  name,
  photoUrl,
  size = "sm",
  className,
  ring = true,
}: {
  name: string | null | undefined;
  photoUrl?: string | null;
  size?: AvatarSize;
  className?: string;
  ring?: boolean;
}) {
  return (
    <Avatar
      className={cn(
        SIZES[size],
        "shrink-0",
        ring && "ring-1 ring-[color:var(--color-hairline)] ring-offset-1 ring-offset-card",
        "shadow-[var(--shadow-xs)]",
        className,
      )}
    >
      {photoUrl ? <AvatarImage src={photoUrl} alt={name ?? "Profile photo"} loading="lazy" /> : null}
      <AvatarFallback className={cn("font-semibold", tintFor(name ?? "?"))}>
        {initialsFor(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Brand/logo tile — squircle, white plate so logos keep their own colour. */
export function BrandAvatar({
  name,
  logoUrl,
  size = "sm",
  className,
}: {
  name: string | null | undefined;
  logoUrl?: string | null;
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-xl border border-[color:var(--color-hairline)] bg-white shadow-[var(--shadow-xs)]",
        SIZES[size],
        className,
      )}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={`${name ?? "Brand"} logo`}
          loading="lazy"
          className="h-full w-full object-contain p-1"
        />
      ) : (
        <span className={cn("grid h-full w-full place-items-center font-semibold", tintFor(name ?? "?"))}>
          {initialsFor(name)}
        </span>
      )}
    </span>
  );
}

/** Person avatar + name/meta, the standard people cell. */
export function PersonCell({
  name,
  photoUrl,
  meta,
  size = "sm",
  action,
}: {
  name: string | null | undefined;
  photoUrl?: string | null;
  meta?: ReactNode;
  size?: AvatarSize;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <PersonAvatar name={name} photoUrl={photoUrl} size={size} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{name ?? "—"}</p>
        {meta ? <p className="truncate text-[11px] text-[color:var(--color-ink-3)]">{meta}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Brand logo + name/meta. */
export function BrandCell({
  name,
  logoUrl,
  meta,
  size = "sm",
}: {
  name: string | null | undefined;
  logoUrl?: string | null;
  meta?: ReactNode;
  size?: AvatarSize;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <BrandAvatar name={name} logoUrl={logoUrl} size={size} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{name ?? "—"}</p>
        {meta ? <p className="truncate text-[11px] text-[color:var(--color-ink-3)]">{meta}</p> : null}
      </div>
    </div>
  );
}

/** Overlapping roster preview. */
export function AvatarStack({
  people,
  max = 6,
  size = "sm",
}: {
  people: { id?: string; name: string | null; photoUrl?: string | null }[];
  max?: number;
  size?: AvatarSize;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <PersonAvatar
          key={p.id ?? `${p.name}-${i}`}
          name={p.name}
          photoUrl={p.photoUrl}
          size={size}
          className={i > 0 ? "-ml-2" : undefined}
        />
      ))}
      {rest > 0 ? (
        <span
          className={cn(
            SIZES[size],
            "-ml-2 grid place-items-center rounded-full border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-3)] font-semibold text-[color:var(--color-ink-2)]",
          )}
        >
          +{rest}
        </span>
      ) : null}
    </div>
  );
}

/** Small "Demo data" marker for seeded sandbox rows. */
export function DemoChip({ className, label = "Demo data" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-[color:var(--color-g-yellow-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#7a4b00]",
        className,
      )}
      title="Seeded sandbox row — removed before live import (delete where is_demo)"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[#e8a33d]" />
      {label}
    </span>
  );
}
