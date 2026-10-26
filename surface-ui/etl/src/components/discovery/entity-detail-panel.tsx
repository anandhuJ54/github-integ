import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@v3/ui/components/ui/sheet";
import { Badge } from "@v3/ui/components/ui/badge";
import { PayloadFields } from "@v3/etl/components/discovery/pipeline-tab";
import { cn } from "@v3/ui/lib/utils";
import { api } from "@v3/ui/lib/server-fn";
import {
  REL_TYPES,
  TYPE_LABEL,
  TYPE_STYLES,
  decodeEntities,
  fmtDate,
  gcidLabels,
  sourceLabel,
  type HierFilters,
} from "./hierarchy-data";

type Other = { entity_id: string; display_name: string | null; entity_type: string | null } | null;

function TypeBadge({ t }: { t: string | null }) {
  return (
    <Badge variant="secondary" className={cn("font-normal", TYPE_STYLES[t ?? ""] ?? "bg-slate-100 text-slate-600")}>
      {TYPE_LABEL[t ?? ""] ?? t ?? "—"}
    </Badge>
  );
}

const isUrl = (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v);

function firstUrl(...objs: unknown[]): string | null {
  const walk = (v: unknown): string | null => {
    if (isUrl(v)) return v as string;
    if (Array.isArray(v)) for (const x of v) { const r = walk(x); if (r) return r; }
    else if (v && typeof v === "object") for (const x of Object.values(v)) { const r = walk(x); if (r) return r; }
    return null;
  };
  for (const o of objs) { const r = walk(o); if (r) return r; }
  return null;
}

function KV({ obj }: { obj: unknown }) {
  if (!obj || typeof obj !== "object" || Object.keys(obj).length === 0)
    return <p className="text-xs text-slate-400">—</p>;
  return (
    <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-xs">
      {Object.entries(obj as Record<string, unknown>).map(([k, v]) => (
        <div key={k} className="flex gap-3 px-3 py-1.5">
          <dt className="w-36 shrink-0 font-medium text-slate-500">{k}</dt>
          <dd className="min-w-0 flex-1 break-words text-ink">
            {isUrl(v) ? (
              <a href={v as string} target="_blank" rel="noreferrer" className="text-[color:var(--color-g-blue)] underline">
                {v as string}
              </a>
            ) : typeof v === "object" && v !== null ? (
              <code className="text-[11px]">{JSON.stringify(v)}</code>
            ) : (
              String(v ?? "—")
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Which table filter shows the incoming rows of a given type for this entity.
function filterFor(relType: string, id: string): HierFilters | null {
  if (relType === "WORKS_AT") return { office: id, type: "professional" };
  if (relType === "REPRESENTS") return { brand: id, type: "professional" };
  if (relType === "OPERATES_UNDER") return { brand: id, type: "location" };
  return null;
}

export function EntityDetailPanel({
  entityId,
  onOpenEntity,
  onClose,
  onShowInTable,
}: {
  entityId: string | null;
  onOpenEntity: (id: string) => void;
  onClose: () => void;
  onShowInTable: (f: HierFilters) => void;
}) {
  const open = !!entityId;

  // One request (GET /etl/console/hierarchy/entities/{id}); the four views share its cache entry.
  const detail = {
    queryKey: ["hier_detail", entityId],
    enabled: open,
    queryFn: () =>
      api.get<{
        entity: any;
        out: { relationship_type: string; object_gcid: string | null; obj: Other }[];
        outLabels: Record<string, string>;
        incoming: { type: string; count: number; rows: Other[] }[];
        staged: any[];
      }>(`/etl/console/hierarchy/entities/${encodeURIComponent(entityId!)}`),
  };
  const ent = useQuery({ ...detail, select: (d) => d.entity as any });
  const out = useQuery({ ...detail, select: (d) => ({ rows: d.out, labels: d.outLabels }) });
  const inc = useQuery({ ...detail, select: (d) => d.incoming });
  const staged = useQuery({ ...detail, select: (d) => d.staged });

  const e = ent.data;
  const category = out.data?.rows.find((r) => r.relationship_type === "CLASSIFIED_AS");
  const lastObserved = staged.data?.[0]?.observed_at;
  const srcPage = e ? firstUrl(e.identity_keys, e.attributes) : null;

  const outGroups = new Map<string, { relationship_type: string; object_gcid: string | null; obj: Other }[]>();
  for (const r of out.data?.rows ?? []) {
    if (r.relationship_type === "CLASSIFIED_AS") continue;
    const l = outGroups.get(r.relationship_type) ?? [];
    l.push(r);
    outGroups.set(r.relationship_type, l);
  }

  const OtherLink = ({ o }: { o: Other }) =>
    o ? (
      <button type="button" onClick={() => onOpenEntity(o.entity_id)} className="flex items-center gap-2 text-left text-xs hover:underline">
        <span className="text-ink">{decodeEntities(o.display_name) || "Untitled"}</span>
        <TypeBadge t={o.entity_type} />
      </button>
    ) : (
      <span className="text-xs text-slate-400">(hidden entity)</span>
    );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-slate-200 px-6 py-4">
          <SheetTitle className="text-base text-ink">
            {ent.isLoading ? "Loading…" : decodeEntities(e?.display_name) || "Entity"}
          </SheetTitle>
          {e ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <TypeBadge t={e.entity_type} />
              <span>{category ? out.data?.labels[category.object_gcid ?? ""] ?? category.object_gcid : "no category"}</span>
              <span>· {sourceLabel(e.source)}</span>
              <span>· claim: {e.claim_state ?? "—"}</span>
              <span>· conf {e.confidence == null ? "—" : Number(e.confidence).toFixed(2)}</span>
              <span>· created {fmtDate(e.created_at)}</span>
              <span>· last observed {fmtDate(lastObserved)}</span>
            </div>
          ) : null}
          {ent.error ? <p className="text-xs text-red-600">{(ent.error as Error).message}</p> : null}
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {e ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Identity</h3>
              {srcPage ? (
                <a href={srcPage} target="_blank" rel="noreferrer" className="text-xs text-[color:var(--color-g-blue)] underline">
                  Source page ↗
                </a>
              ) : null}
              <p className="text-[11px] font-medium text-slate-400">identity_keys</p>
              <KV obj={e.identity_keys} />
              <p className="text-[11px] font-medium text-slate-400">attributes</p>
              <KV obj={e.attributes} />
            </section>
          ) : null}

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Links</h3>
            {out.error || inc.error ? (
              <p className="text-xs text-red-600">{((out.error ?? inc.error) as Error).message}</p>
            ) : null}
            <p className="text-[11px] font-medium text-slate-400">Outgoing</p>
            {out.isLoading ? <p className="text-xs text-slate-500">Loading…</p> : outGroups.size === 0 ? (
              <p className="text-xs text-slate-400">None</p>
            ) : (
              [...outGroups.entries()].map(([t, rows]) => (
                <div key={t} className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="mb-1.5 text-[11px] font-semibold text-slate-500">{t} ({rows.length})</p>
                  <div className="space-y-1">{rows.map((r, i) => <OtherLink key={i} o={r.obj} />)}</div>
                </div>
              ))
            )}
            <p className="text-[11px] font-medium text-slate-400">Incoming</p>
            {inc.isLoading ? <p className="text-xs text-slate-500">Loading…</p> : !inc.data?.length ? (
              <p className="text-xs text-slate-400">None</p>
            ) : (
              inc.data.map((g) => {
                const f = entityId ? filterFor(g.type, entityId) : null;
                return (
                  <div key={g.type} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="mb-1.5 flex items-center gap-2">
                      <p className="flex-1 text-[11px] font-semibold text-slate-500">
                        {g.type} ({g.count.toLocaleString()}){g.count > 20 ? " · first 20" : ""}
                      </p>
                      {f ? (
                        <button type="button" onClick={() => onShowInTable(f)} className="text-[11px] text-[color:var(--color-g-blue)] hover:underline">
                          Show in table
                        </button>
                      ) : null}
                    </div>
                    <div className="space-y-1">{g.rows.map((o, i) => <OtherLink key={i} o={o} />)}</div>
                  </div>
                );
              })
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Staged records</h3>
            {staged.error ? <p className="text-xs text-red-600">{(staged.error as Error).message}</p> : null}
            {staged.isLoading ? <p className="text-xs text-slate-500">Loading…</p> : !staged.data?.length ? (
              <p className="text-xs text-slate-400">No staged records linked to this entity.</p>
            ) : (
              staged.data.map((r) => (
                <div key={r.stage_id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {r.field_tier ? <span>tier {r.field_tier}</span> : null}
                    {r.observed_at ? <span>· {new Date(r.observed_at).toLocaleString()}</span> : null}
                    {r.detail_url ? (
                      <a href={r.detail_url} target="_blank" rel="noreferrer" className="truncate text-[color:var(--color-g-blue)] underline">
                        {r.detail_url}
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-3"><PayloadFields value={r.payload ?? {}} /></div>
                </div>
              ))
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
