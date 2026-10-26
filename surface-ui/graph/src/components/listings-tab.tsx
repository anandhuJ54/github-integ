import { useEffect, useState } from "react";
import { api } from "@v3/ui/lib/server-fn";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@v3/ui/lib/utils";
import { fetchCatalogs } from "@v3/graph/lib/listings/catalog";
import {
  PUBLISHER_CATALOGS, STUB_PUBLISHERS, type PublisherCatalog, type RowStatus, type Section,
} from "@v3/graph/lib/listings/catalog.fallback";

/** Listings tab — publisher mapping catalog.
 *  Column order (Scott, 2026-07-09): Their Field | Our Mapped Field | Rules.
 *  Catalogs are read from exp_listings_publishers + exp_listings_field_map (migration 0026).
 *  Until 0026 is applied the deprecated constants in @/lib/listings/catalog.fallback render
 *  instead — identical content, since 0026 is generated from them.
 *  This is an OUTPUT mapping — it does not change the model; "missing_ours" rows
 *  are enrichment candidates only. */

/** Cards expanded on first render (unchanged from the pre-DB layout). */
const DEFAULT_OPEN = new Set(["data_axle", "google"]);

function StatusChip({ s }: { s: RowStatus }) {
  if (s === "mapped") return <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700">mapped</span>;
  if (s === "missing_ours") return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700"><AlertTriangle className="w-3 h-3" />missing</span>;
  if (s === "pipeline") return <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-sky-50 text-sky-700">pipeline</span>;
  return <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-500">n/a</span>;
}


function PublisherCard({ name, subtitle, sections, publishesTo, opsNotes, defaultOpen = false }:
  { name: string; subtitle: string; sections: Section[]; publishesTo: string; opsNotes: string[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const missing = sections.flatMap(s => s.rows).filter(r => r.status === "missing_ours").length;
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          <span className="font-semibold text-slate-900">{name}</span>
          <span className="text-xs text-slate-400">{subtitle}</span>
        </div>
        <span className="text-xs text-slate-400">{missing} enrichment candidate{missing === 1 ? "" : "s"}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-5 pb-5">
          {sections.map(sec => (
            <div key={sec.title} className="mt-5">
              <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{sec.title}</div>
              {sec.note && <div className="text-xs text-slate-500 mt-0.5">{sec.note}</div>}
              <table className="w-full mt-2 text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="py-1.5 pr-3 w-[24%] font-medium">Their field</th>
                    <th className="py-1.5 pr-3 w-[30%] font-medium">Our mapped field</th>
                    <th className="py-1.5 pr-3 font-medium">Rules</th>
                    <th className="py-1.5 w-[70px]" />
                  </tr>
                </thead>
                <tbody className="align-top">
                  {sec.rows.map(r => (
                    <tr key={r.their} className="border-t border-slate-100">
                      <td className="py-2 pr-3 font-medium text-slate-800">{r.their}</td>
                      <td className={cn("py-2 pr-3", r.status === "missing_ours" ? "text-amber-700" : "text-slate-600")}>{r.ours}</td>
                      <td className="py-2 pr-3 text-slate-500 text-[13px] leading-snug">{r.rules}</td>
                      <td className="py-2 text-right"><StatusChip s={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div className="mt-6 rounded-lg bg-slate-50 p-4">
            <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Publishes to</div>
            <div className="text-sm text-slate-600 mt-1">{publishesTo}</div>
            <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase mt-4">Operational rules</div>
            <ul className="mt-1 space-y-1">
              {opsNotes.map(n => <li key={n} className="text-[13px] text-slate-500">· {n}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export function ListingsTab({ gcid, entityType }: { gcid: string; entityType?: string | null }) {
  const [overlays, setOverlays] = useState<string[] | null>(null);
  const [xwalk, setXwalk] = useState<Record<string, { code: string; label: string | null; breadcrumb: string | null; confidence: string | null }>>({});
  const [famPresent, setFamPresent] = useState<Record<string, boolean> | null>(null);
  const [catalogs, setCatalogs] = useState<PublisherCatalog[]>(PUBLISHER_CATALOGS);
  useEffect(() => {
    let live = true;
    fetchCatalogs()
      .then(c => { if (live && c) setCatalogs(c); })
      .catch(() => { /* keep fallback */ });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      // the three reads in one request; a failed one comes back null (its `data` on error)
      const res = await api.get<{
        overlays: { overlay: string }[] | null;
        crosswalk: { publisher_id: string; code: string; label: string | null; breadcrumb: string | null; confidence: string | null }[] | null;
        status: { family: string; present: boolean }[] | null;
      }>("/graph/categories/listings", { params: { gcid } })
        .catch(() => ({ overlays: null, crosswalk: null, status: null }));
      const [o, x, f] = [{ data: res.overlays }, { data: res.crosswalk }, { data: res.status }];
      if (!live) return;
      setOverlays(o.data ? o.data.map(r => r.overlay) : null);
      const xm: any = {}; (x.data ?? []).forEach(r => { xm[r.publisher_id] = r; });
      setXwalk(xm);
      const fm: any = {}; (f.data ?? []).forEach(r => { fm[r.family] = r.present; });
      setFamPresent(f.data && f.data.length ? fm : null);
    })();
    return () => { live = false; };
  }, [gcid]);

  // Per-category resolution: sections gate on overlays; variant rows flip on family presence;
  // crosswalk rows show the category's actual codes. Falls back to the static catalog when tables are empty.
  const resolve = (sections: Section[], pub: string): Section[] =>
    sections
      .filter(sec => !sec.applicability || overlays === null || overlays.includes(sec.applicability))
      .map(sec => ({
        ...sec,
        rows: sec.rows.map(r => {
          let out = { ...r };
          if (famPresent && r.family && famPresent[r.family] !== undefined) {
            out.status = famPresent[r.family] ? "mapped" : "missing_ours";
            if (famPresent[r.family] && out.ours.startsWith("—")) out.ours = out.ours.replace(/^\S+ /, "Registry: ");
          }
          const xw = xwalk[pub];
          if (xw && (r.their === "Primary SIC" || r.their.startsWith("categories"))) {
            out.ours = `${xw.code}${xw.label ? " · " + xw.label : ""}`;
            out.rules = (xw.breadcrumb ? xw.breadcrumb + ". " : "") + `Confidence: ${xw.confidence ?? "n/a"}; verified on first live API call. ` + r.rules;
            out.status = "mapped";
          }
          return out;
        }),
      }));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-300 bg-slate-900 text-white p-5">
        <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase">The Hub — Experience.com</div>
        <div className="text-sm mt-1.5 text-slate-200">
          The canonical record for <span className="font-mono">{gcid}</span>: full graph, all rings, unbounded
          instances, schema.org projections. Every publisher below receives a slice of this record — and every
          verified listing returns as a <span className="font-mono">sameAs</span> edge
          (entity_external_ids), corroborating the hub. Search Console rides the hub as its read-and-verify rail
          (index status, performance signals, sitemaps).
        </div>
      </div>
      <div className="text-sm text-slate-500">
        Publisher projections — output-only: this catalog maps the hub onto each publisher’s API and changes
        nothing about the model. Amber rows are enrichment candidates.
      </div>

      {catalogs.map(c => (
        <PublisherCard
          key={c.id}
          name={c.name}
          subtitle={c.subtitle}
          sections={resolve(c.sections, c.id)}
          publishesTo={c.publishesTo}
          opsNotes={c.opsNotes}
          defaultOpen={DEFAULT_OPEN.has(c.id)}
        />
      ))}

      {/* Stubs */}
      {STUB_PUBLISHERS.map(p => (
        <div key={p} className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ChevronRight className="w-4 h-4 text-slate-300" />
            <span className="font-medium text-slate-400">{p}</span>
          </div>
          <span className="text-[10px] uppercase tracking-wide text-slate-300 font-semibold">mapping not started</span>
        </div>
      ))}
    </div>
  );
}
