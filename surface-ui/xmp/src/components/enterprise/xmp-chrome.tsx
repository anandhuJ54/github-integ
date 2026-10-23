import type { ReactNode } from "react";
import { EnterpriseShell } from "@v3/xmp/components/enterprise/enterprise-shell";
import type { Brand } from "@v3/xmp/lib/enterprise-xmp";

/**
 * Legacy alias — every enterprise.$orgSlug.* route mounts through this and now
 * renders inside the dedicated Enterprise shell (own left nav + Viewing-as
 * bar), never inside the admin console shell.
 */
export function XmpShell({
  brand,
  slug,
  children,
}: {
  brand: Brand | null;
  slug: string;
  children: ReactNode;
}) {
  return (
    <EnterpriseShell brand={brand} slug={slug}>
      {children}
    </EnterpriseShell>
  );
}

export function CoverageBar({
  label,
  part,
  whole,
}: {
  label: string;
  part: number;
  whole: number;
}) {
  const p = whole > 0 ? part / whole : 0;
  const tone = p >= 0.6 ? "#1e8e3e" : p >= 0.2 ? "#b06000" : "#c5221f";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium text-ink">{label}</span>
        <span className="tabular-nums text-[color:var(--color-ink-2)]">
          {part.toLocaleString()} / {whole.toLocaleString()} ·{" "}
          {(p * 100).toFixed(p < 0.1 ? 1 : 0)}%
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, p * 100)}%`, background: tone }}
        />
      </div>
    </div>
  );
}
