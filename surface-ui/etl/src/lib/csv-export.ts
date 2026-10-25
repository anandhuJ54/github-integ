// etl's own copy of the browser CSV download helper (surface audit §11 row 7a, 2026-10-25: the lib it
// came from, enterprise-ops.ts, moved to xmp). Same behaviour as csvExport in
// surface-ui/xmp/src/lib/enterprise-ops.ts.
export function csvExport(filename: string, rows: Record<string, unknown>[]) {
  const cols = rows.length ? Object.keys(rows[0]!) : [];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
