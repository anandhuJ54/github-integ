import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Network } from "lucide-react";
import { Badge } from "@v3/shared/components/ui/badge";
import { Button } from "@v3/shared/components/ui/button";
import { Input } from "@v3/shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@v3/shared/components/ui/select";
import { cn } from "@v3/shared/components/utils/utils";
import { SearchSelect, type Opt } from "./search-select";
import { EntityDetailPanel } from "./entity-detail-panel";
import { api } from "@v3/state/api/server-fn";
import {
  PAGE_SIZE,
  TYPE_LABEL,
  TYPE_STYLES,
  decodeEntities,
  fmtDate,
  gcidLabels,
  sourceLabel,
  type EntityRow,
  type HierFilters,
} from "./hierarchy-data";

const H = "/etl/console/hierarchy";

/* ─────────── URL state ─────────── */
const KEYS = {
  gcid: "h_gcid", source: "h_src", brand: "h_brand", office: "h_office",
  type: "h_type", claim: "h_claim", q: "h_q",
} as const;
type UrlState = HierFilters & { page: number; sort: string; dir: "asc" | "desc"; view: "table" | "tree" };
const SORT_COLS: Record<string, string> = { name: "display_name", type: "entity_type", confidence: "confidence", created: "created_at" };

function useHierState() {
  const raw = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const str = (k: string) => (raw[k] == null || raw[k] === "" ? undefined : String(raw[k]));
  const state: UrlState = {
    gcid: str(KEYS.gcid), source: str(KEYS.source), brand: str(KEYS.brand), office: str(KEYS.office),
    type: str(KEYS.type), claim: str(KEYS.claim), q: str(KEYS.q),
    page: Math.max(1, Number(raw.h_page) || 1),
    sort: SORT_COLS[str("h_sort") ?? ""] ? (str("h_sort") as string) : "created",
    dir: str("h_dir") === "asc" ? "asc" : "desc",
    view: str("h_view") === "tree" ? "tree" : "table",
  };
  const set = (patch: Partial<UrlState>, resetPage = true) => {
    const next = { ...state, ...patch };
    if (resetPage && patch.page === undefined) next.page = 1;
    navigate({
      search: ((prev: Record<string, unknown>) => {
        const out: Record<string, unknown> = { ...prev };
        for (const [k, key] of Object.entries(KEYS)) {
          const v = next[k as keyof HierFilters];
          if (v) out[key] = v; else delete out[key];
        }
        if (next.page > 1) out.h_page = next.page; else delete out.h_page;
        if (next.sort !== "created") out.h_sort = next.sort; else delete out.h_sort;
        if (next.dir !== "desc") out.h_dir = next.dir; else delete out.h_dir;
        if (next.view !== "table") out.h_view = next.view; else delete out.h_view;
        return out;
      }) as never,
      replace: true,
    } as never);
  };
  return { state, set };
}

function TypeBadge({ t }: { t: string | null }) {
  return (
    <Badge variant="secondary" className={cn("font-normal", TYPE_STYLES[t ?? ""] ?? "bg-slate-100 text-slate-600")}>
      {TYPE_LABEL[t ?? ""] ?? t ?? "—"}
    </Badge>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{(error as Error).message ?? String(error)}</div>;
}

/* ─────────── Filter option data ─────────── */
function useFilterOptions(gcid?: string, catTerm?: string) {
  const sources = useQuery({
    queryKey: ["hier_sources"],
    queryFn: () =>
      api.get<{ rows: { source_domain: string | null; gcid: string | null }[]; labels: Record<string, string> }>(
        `${H}/sources`,
      ),
  });
  const catSearch = useQuery({
    queryKey: ["hier_cat_search", catTerm],
    enabled: !!catTerm && catTerm.length >= 2,
    // the API strips %_,()* from the term, as this did
    queryFn: () => api.get<{ gcid: string; display_name: string }[]>(`${H}/category-search`, { params: { term: catTerm! } }),
  });
  const brands = useQuery({
    queryKey: ["hier_brands"],
    queryFn: () => api.get<{ entity_id: string; display_name: string | null }[]>(`${H}/brands`),
  });
  const selectedCatLabel = useQuery({
    queryKey: ["hier_cat_label", gcid],
    enabled: !!gcid,
    queryFn: () => gcidLabels([gcid!]),
  });

  const catOptions: Opt[] = useMemo(() => {
    if (catTerm && catTerm.length >= 2)
      return (catSearch.data ?? []).map((c) => ({ value: c.gcid, label: c.display_name, hint: c.gcid }));
    const seen = new Set<string>();
    const out: Opt[] = [];
    for (const r of sources.data?.rows ?? []) {
      if (!r.gcid || seen.has(r.gcid)) continue;
      seen.add(r.gcid);
      out.push({ value: r.gcid, label: sources.data?.labels[r.gcid] ?? r.gcid, hint: r.gcid });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [catTerm, catSearch.data, sources.data]);

  const srcOptions: Opt[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Opt[] = [];
    for (const r of sources.data?.rows ?? []) {
      if (!r.source_domain || (gcid && r.gcid !== gcid)) continue;
      const v = `etl:${r.source_domain}`;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push({ value: v, label: r.source_domain });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [sources.data, gcid]);

  const brandOptions: Opt[] = (brands.data ?? []).map((b) => ({ value: b.entity_id, label: decodeEntities(b.display_name) || "Untitled" }));

  return {
    catOptions, srcOptions, brandOptions,
    catLabel: gcid ? selectedCatLabel.data?.[gcid] ?? gcid : undefined,
    error: sources.error ?? brands.error ?? catSearch.error,
  };
}

/* ─────────── Table ─────────── */
type PageRel = {
  subject_entity_id: string;
  relationship_type: string;
  object_entity_id: string | null;
  object_gcid: string | null;
  obj: { display_name: string | null } | null;
};

function useTablePage(s: UrlState) {
  const f: HierFilters = s;
  const from = (s.page - 1) * PAGE_SIZE;
  return useQuery({
    queryKey: ["hier_table", f.gcid, f.source, f.brand, f.office, f.type, f.claim, f.q, s.page, s.sort, s.dir],
    placeholderData: keepPreviousData,
    // the page of entities, their current relationships, category labels and hub sizes
    queryFn: () =>
      api.post<{
        rows: EntityRow[];
        total: number;
        rels: PageRel[];
        labels: Record<string, string>;
        counts: Record<string, number>;
      }>(`${H}/table`, { filters: f, page: s.page, sort: s.sort, dir: s.dir }),
  });
}

function useCounts(f: HierFilters) {
  return useQuery({
    queryKey: ["hier_counts", f.gcid, f.source, f.brand, f.office, f.claim, f.q, f.type],
    queryFn: () => api.post<{ brand: number; location: number; professional: number }>(`${H}/counts`, f),
  });
}

function SortHead({ label, col, s, set }: { label: string; col: string; s: UrlState; set: (p: Partial<UrlState>) => void }) {
  const active = s.sort === col;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 uppercase hover:text-ink"
      onClick={() => set({ sort: col, dir: active && s.dir === "desc" ? "asc" : active ? "desc" : col === "name" ? "asc" : "desc" })}
    >
      {label}
      {active ? s.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
    </button>
  );
}

function TableView({ s, set, onOpen }: { s: UrlState; set: (p: Partial<UrlState>, r?: boolean) => void; onOpen: (id: string) => void }) {
  const q = useTablePage(s);
  const total = q.data?.total ?? 0;
  const from = (s.page - 1) * PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const relOf = (id: string, t: string) => q.data?.rels.find((r) => r.subject_entity_id === id && r.relationship_type === t);
  const th = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500";

  return (
    <div className="space-y-3">
      <ErrorLine error={q.error} />
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className={th}><SortHead label="Name" col="name" s={s} set={set} /></th>
              <th className={th}><SortHead label="Type" col="type" s={s} set={set} /></th>
              <th className={th}>Category</th>
              <th className={th}>Source</th>
              <th className={th}>Office</th>
              <th className={th}>Brand</th>
              <th className={cn(th, "text-right")}>Advisors</th>
              <th className={cn(th, "text-right")}><SortHead label="Confidence" col="confidence" s={s} set={set} /></th>
              <th className={th}>Claim</th>
              <th className={th}><SortHead label="Created" col="created" s={s} set={set} /></th>
            </tr>
          </thead>
          <tbody className={cn(q.isFetching && "opacity-60")}>
            {q.isLoading ? (
              <tr><td colSpan={10} className="py-10 text-center text-sm text-slate-500">Loading entities…</td></tr>
            ) : !q.data?.rows.length ? (
              <tr><td colSpan={10} className="py-10 text-center text-sm text-slate-500">No entities match these filters.</td></tr>
            ) : (
              q.data.rows.map((r) => {
                const cat = relOf(r.entity_id, "CLASSIFIED_AS");
                const office = r.entity_type === "professional" ? relOf(r.entity_id, "WORKS_AT") : undefined;
                const brand =
                  r.entity_type === "professional" ? relOf(r.entity_id, "REPRESENTS")
                  : r.entity_type === "location" ? relOf(r.entity_id, "OPERATES_UNDER") : undefined;
                const cnt = q.data.counts[r.entity_id];
                return (
                  <tr key={r.entity_id} onClick={() => onOpen(r.entity_id)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-medium text-ink">{decodeEntities(r.display_name) || "Untitled"}</td>
                    <td className="px-3 py-2.5"><TypeBadge t={r.entity_type} /></td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{cat ? q.data.labels[cat.object_gcid ?? ""] ?? cat.object_gcid : "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{sourceLabel(r.source)}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {office?.object_entity_id ? (
                        <button type="button" className="text-[color:var(--color-g-blue)] hover:underline"
                          onClick={(e) => { e.stopPropagation(); set({ office: office.object_entity_id!, type: "professional" }); }}>
                          {decodeEntities(office.obj?.display_name) || "Untitled"}
                        </button>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {brand?.object_entity_id ? (
                        <button type="button" className="text-[color:var(--color-g-blue)] hover:underline"
                          onClick={(e) => { e.stopPropagation(); set({ brand: brand.object_entity_id!, office: undefined }); }}>
                          {decodeEntities(brand.obj?.display_name) || "Untitled"}
                        </button>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums">{cnt == null ? "–" : cnt.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums">{r.confidence == null ? "—" : Number(r.confidence).toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-xs capitalize text-slate-600">{r.claim_state ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{fmtDate(r.created_at)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{total ? `Showing ${(from + 1).toLocaleString()}–${Math.min(from + PAGE_SIZE, total).toLocaleString()} of ${total.toLocaleString()}` : ""}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={s.page <= 1} onClick={() => set({ page: s.page - 1 }, false)}>Previous</Button>
          <span>Page {s.page} of {pages.toLocaleString()}</span>
          <Button variant="outline" size="sm" disabled={s.page >= pages} onClick={() => set({ page: s.page + 1 }, false)}>Next</Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── Tree ─────────── */
function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 py-1 text-[11px] text-slate-500">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="hover:underline disabled:opacity-40">‹ Prev</button>
      <span>{page} / {pages}</span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="hover:underline disabled:opacity-40">Next ›</button>
    </div>
  );
}

function EntityLine({ e, onOpen, extra }: { e: EntityRow; onOpen: (id: string) => void; extra?: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <button type="button" onClick={() => onOpen(e.entity_id)} className="text-sm text-ink hover:underline">
        {decodeEntities(e.display_name) || "Untitled"}
      </button>
      <TypeBadge t={e.entity_type} />
      {extra ? <span className="text-xs text-slate-500">{extra}</span> : null}
    </div>
  );
}


function AdvisorList({ filter, onOpen }: { filter: { office?: string; unofficedBrand?: string }; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["hier_tree_adv", filter.office, filter.unofficedBrand, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.get<{ rows: EntityRow[]; total: number }>(`${H}/tree/advisors`, {
        params: filter.office ? { office: filter.office, page } : { unofficed_brand: filter.unofficedBrand, page },
      }),
  });
  if (q.error) return <ErrorLine error={q.error} />;
  if (q.isLoading) return <p className="py-1 text-xs text-slate-500">Loading advisors…</p>;
  if (!q.data?.rows.length) return <p className="py-1 text-xs text-slate-400">No advisors.</p>;
  return (
    <div>
      {q.data.rows.map((e) => <EntityLine key={e.entity_id} e={e} onOpen={onOpen} />)}
      <Pager page={page} total={q.data.total} onPage={setPage} />
    </div>
  );
}

function OfficeNode({ e, onOpen }: { e: EntityRow & { advisors: number }; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setOpen(!open)} className="text-slate-400 hover:text-slate-600" aria-label={open ? "Collapse" : "Expand"}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <EntityLine e={e} onOpen={onOpen} extra={`${e.advisors.toLocaleString()} advisors`} />
      </div>
      {open ? <div className="ml-6 border-l border-slate-100 pl-3"><AdvisorList filter={{ office: e.entity_id }} onOpen={onOpen} /></div> : null}
    </div>
  );
}

function TreeView({ brand, brandLabel, onOpen }: { brand?: string; brandLabel?: string; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const [unofficedOpen, setUnofficedOpen] = useState(false);
  useEffect(() => { setPage(1); setUnofficedOpen(false); }, [brand]);
  const offices = useQuery({
    queryKey: ["hier_tree_offices", brand, page],
    enabled: !!brand,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.get<{ rows: (EntityRow & { advisors: number })[]; total: number }>(`${H}/tree/offices`, {
        params: { brand: brand!, page },
      }),
  });

  if (!brand) return <div className="rounded-xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-500">Pick a brand to see its tree.</div>;
  return (
    <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-4">
      <button type="button" onClick={() => onOpen(brand)} className="text-sm font-semibold text-ink hover:underline">{brandLabel ?? "Brand"}</button>
      <ErrorLine error={offices.error} />
      <div className="ml-2 border-l border-slate-100 pl-3">
        <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Offices {offices.data ? `(${offices.data.total.toLocaleString()})` : ""}
        </p>
        {offices.isLoading ? <p className="py-1 text-xs text-slate-500">Loading offices…</p> : !offices.data?.rows.length ? (
          <p className="py-1 text-xs text-slate-400">No offices.</p>
        ) : (
          offices.data.rows.map((o) => <OfficeNode key={o.entity_id} e={o} onOpen={onOpen} />)
        )}
        {offices.data ? <Pager page={page} total={offices.data.total} onPage={setPage} /> : null}
        <button type="button" onClick={() => setUnofficedOpen(!unofficedOpen)} className="mt-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-ink">
          {unofficedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Advisors without an office
        </button>
        {unofficedOpen ? <div className="ml-5"><AdvisorList filter={{ unofficedBrand: brand }} onOpen={onOpen} /></div> : null}
      </div>
    </div>
  );
}

/* ─────────── Tab ─────────── */
export function HierarchyTab() {
  const { state: s, set } = useHierState();
  const [catTerm, setCatTerm] = useState("");
  const [search, setSearch] = useState(s.q ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const opts = useFilterOptions(s.gcid, catTerm);
  const counts = useCounts(s);

  useEffect(() => {
    const t = setTimeout(() => { if ((search.trim() || undefined) !== s.q) set({ q: search.trim() || undefined }); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const brandLabel = opts.brandOptions.find((b) => b.value === s.brand)?.label;
  const officeName = useQuery({
    queryKey: ["hier_office_name", s.office],
    enabled: !!s.office,
    queryFn: async () => {
      const data = await api.get<{ display_name: string | null } | null>(`${H}/office-name`, { params: { office: s.office! } });
      return decodeEntities(data?.display_name) || "office";
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <Network className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span>brand → offices (OPERATES_UNDER) → advisors (WORKS_AT); advisors also link to the brand (REPRESENTS).</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchSelect placeholder="Category" value={s.gcid} valueLabel={opts.catLabel} options={opts.catOptions}
          onSearch={setCatTerm} onChange={(v) => set({ gcid: v, source: undefined })} />
        <SearchSelect placeholder="Source" value={s.source} valueLabel={sourceLabel(s.source)} options={opts.srcOptions}
          allowCustom onChange={(v) => set({ source: v })} />
        <SearchSelect placeholder="Brand" value={s.brand} valueLabel={brandLabel ?? "Brand"} options={opts.brandOptions}
          onChange={(v) => set({ brand: v })} />
        <Select value={s.type ?? "all"} onValueChange={(v) => set({ type: v === "all" ? undefined : v })}>
          <SelectTrigger className="h-9 w-[140px] bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="brand">Brand</SelectItem>
            <SelectItem value="location">Office</SelectItem>
            <SelectItem value="professional">Advisor</SelectItem>
            <SelectItem value="team">Team</SelectItem>
          </SelectContent>
        </Select>
        <Select value={s.claim ?? "all"} onValueChange={(v) => set({ claim: v === "all" ? undefined : v })}>
          <SelectTrigger className="h-9 w-[150px] bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All claim states</SelectItem>
            <SelectItem value="unclaimed">Unclaimed</SelectItem>
            <SelectItem value="claimed">Claimed</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
          </SelectContent>
        </Select>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name contains…" className="h-9 w-[200px] bg-white" />
        <div className="ml-auto flex rounded-md border border-slate-200 bg-white p-0.5">
          {(["table", "tree"] as const).map((v) => (
            <button key={v} type="button" onClick={() => set({ view: v }, false)}
              className={cn("rounded px-3 py-1 text-xs capitalize", s.view === v ? "bg-slate-100 font-semibold text-ink" : "text-slate-500")}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {s.office ? (
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <Badge variant="secondary" className="font-normal">Office: {officeName.data ?? "…"}</Badge>
          <button type="button" className="text-[color:var(--color-g-blue)] hover:underline" onClick={() => set({ office: undefined })}>clear</button>
        </div>
      ) : null}

      <ErrorLine error={opts.error ?? counts.error} />
      {s.view === "table" ? (
        <>
          <p className="text-xs text-slate-500">
            {counts.data
              ? `${counts.data.brand.toLocaleString()} brands · ${counts.data.location.toLocaleString()} offices · ${counts.data.professional.toLocaleString()} advisors`
              : "Counting…"}
          </p>
          <TableView s={s} set={set} onOpen={setSelected} />
        </>
      ) : (
        <TreeView brand={s.brand} brandLabel={brandLabel} onOpen={setSelected} />
      )}

      <EntityDetailPanel
        entityId={selected}
        onOpenEntity={setSelected}
        onClose={() => setSelected(null)}
        onShowInTable={(f) => { setSelected(null); set({ ...f, view: "table", gcid: s.gcid, source: undefined, claim: undefined, q: undefined, office: f.office, brand: f.brand }); setSearch(""); }}
      />
    </div>
  );
}
