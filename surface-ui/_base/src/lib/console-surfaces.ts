/* ────────────────────────────────────────────────────────────
   Shared number formatting for the console surfaces.
   The live loaders that used to sit here moved to their owners (surface audit §11 row 7b,
   2026-10-25): loadPipelineHealth → surface-ui/etl/src/lib/pipeline-health.ts;
   loadProductCatalog, loadBilling, loadReportMetrics, loadOrgStats →
   surface-ui/admin/src/lib/console-surfaces.ts.
   ──────────────────────────────────────────────────────────── */

export const money = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export const pct = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : `${(Number(n) * 100).toFixed(digits)}%`;

export const num = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("en-US");
