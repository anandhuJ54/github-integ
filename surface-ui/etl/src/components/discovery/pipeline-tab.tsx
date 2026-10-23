import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@v3/ui/lib/server-fn";
import { Badge } from "@v3/ui/components/ui/badge";
import { cn } from "@v3/ui/lib/utils";

type StageRow = {
  stage_id: string;
  source_id: string | null;
  gcid: string | null;
  entity_type: string | null;
  resolution_status: string | null;
  field_tier: string | null;
  observed_at: string | null;
  payload: unknown;
  identity_candidates: unknown;
};

const PAGE_SIZE = 50;
const STATUS_FILTERS = ["pending", "shallow", "created", "matched", "conflicted", "rejected"];

type Filters = { gcid: string; sourceId: string; status: string };

/** Applies the gcid / source / status filters in the database query. */
export function isAddressObject(v: unknown): v is Record<string, unknown> & { text: string } {
  return !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as { text?: unknown }).text === "string";
}

const ADDRESS_PART_LABELS: Record<string, string> = {
  streetAddress: "Street",
  addressLocality: "City",
  addressRegion: "State",
  postalCode: "ZIP",
  addressCountry: "Country",
};

export function AddressValue({ value }: { value: Record<string, unknown> & { text: string } }) {
  const parts = Object.entries(ADDRESS_PART_LABELS).filter(([k]) => typeof value[k] === "string" && value[k]);
  return (
    <div>
      <div>{value.text}</div>
      {parts.length ? (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
          {parts.map(([k, label]) => (
            <span key={k}>
              {label}: {String(value[k])}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Harvested payload: data fields only (keys starting with "_" are metadata); subject badge per value. */
function HarvestPayload({ payload }: { payload: Record<string, unknown> }) {
  const subjects =
    payload._subjects && typeof payload._subjects === "object"
      ? (payload._subjects as Record<string, string>)
      : {};
  const entries = Object.entries(payload).filter(([k]) => !k.startsWith("_"));
  if (entries.length === 0) return <span className="text-slate-400">No fields</span>;
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {k.replace(/_/g, " ")}
            {subjects[k] ? (
              <Badge variant="secondary" className="bg-slate-100 px-1.5 py-0 text-[10px] font-normal normal-case text-slate-500">
                {subjects[k]}
              </Badge>
            ) : null}
          </dt>
          <dd className="mt-0.5 break-words text-sm text-slate-700">
            {isAddressObject(v) ? <AddressValue value={v} /> : <PayloadFields value={v} depth={1} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const STATIC_FIXED_KEYS = ["name", "phone", "email", "street", "city", "state", "postal_code", "branch_name", "firm_name", "url"];
const isEmptyVal = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/** Static (universal) values of a harvested row: fixed identity keys, then identity_candidates.universal. */
function staticEntries(identity: Record<string, unknown>): Array<{ label: string; subject: string | null; value: unknown }> {
  const out: Array<{ label: string; subject: string | null; value: unknown }> = [];
  for (const k of STATIC_FIXED_KEYS) if (!isEmptyVal(identity[k])) out.push({ label: k, subject: null, value: identity[k] });
  const uni =
    identity.universal && typeof identity.universal === "object" && !Array.isArray(identity.universal)
      ? (identity.universal as Record<string, unknown>)
      : {};
  for (const [id, v] of Object.entries(uni)) {
    if (isEmptyVal(v)) continue;
    const i = id.indexOf(".");
    const prefix = i >= 0 ? id.slice(0, i) : "";
    out.push({ label: i >= 0 ? id.slice(i + 1) : id, subject: prefix === "location" ? "branch" : prefix || null, value: v });
  }
  return out;
}

function extraEntries(payload: Record<string, unknown>): Array<[string, unknown]> {
  const ex = payload._extra;
  if (!ex || typeof ex !== "object" || Array.isArray(ex)) return [];
  return Object.entries(ex as Record<string, unknown>).filter(([, v]) => !isEmptyVal(v));
}

function taxonomyCount(payload: Record<string, unknown>): number {
  return Object.keys(payload).filter((k) => !k.startsWith("_")).length;
}

function FieldList({ items }: { items: Array<{ label: string; subject: string | null; value: unknown }> }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={`${it.label}-${i}`} className="min-w-0">
          <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {it.label.replace(/_/g, " ")}
            {it.subject ? (
              <Badge variant="secondary" className="bg-slate-100 px-1.5 py-0 text-[10px] font-normal normal-case text-slate-500">
                {it.subject}
              </Badge>
            ) : null}
          </dt>
          <dd className="mt-0.5 break-words text-sm text-slate-700">
            {isAddressObject(it.value) ? <AddressValue value={it.value} /> : <PayloadFields value={it.value} depth={1} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ProfileSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div>
      <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title} <span className="font-normal tabular-nums text-slate-400">({count})</span>
      </div>
      <div className="mt-2 rounded-lg border border-slate-200 bg-white p-4">{children}</div>
    </div>
  );
}

export const STAGE_STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  matched: "bg-emerald-50 text-emerald-700",
  created: "bg-emerald-50 text-emerald-700",
  corroborated: "bg-teal-50 text-teal-700",
  conflicted: "bg-red-50 text-red-700",
  rejected: "bg-red-50 text-red-700",
  shallow: "bg-amber-50 text-amber-700",
  needs_review: "bg-orange-50 text-orange-700",
};

const FUNNEL: { key: string; label: string; group: string }[] = [
  { key: "pending", label: "Pending", group: "Intake" },
  { key: "matched", label: "Matched", group: "Resolved" },
  { key: "created", label: "Created", group: "Resolved" },
  { key: "corroborated", label: "Corroborated", group: "Resolved" },
  { key: "conflicted", label: "Conflicted", group: "Exceptions" },
  { key: "shallow", label: "Shallow (gated)", group: "Exceptions" },
  { key: "rejected", label: "Rejected", group: "Exceptions" },
];

/** Renders a jsonb payload as a readable labeled field list, nested objects indented. */
export function PayloadFields({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined)
    return <span className="text-slate-400">—</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400">empty</span>;
    if (value.every((v) => typeof v !== "object" || v === null))
      return (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v, i) => (
            <Badge key={i} variant="secondary" className="bg-slate-100 font-normal text-slate-600">
              {String(v)}
            </Badge>
          ))}
        </div>
      );
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <PayloadFields key={i} value={v} depth={depth + 1} />
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <dl
        className={cn(
          "grid gap-x-6 gap-y-2 sm:grid-cols-2",
          depth > 0 && "rounded-lg border border-slate-200 bg-white p-3",
        )}
      >
        {entries.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {k.replace(/_/g, " ")}
            </dt>
            <dd className="mt-0.5 break-words text-sm text-slate-700">
              <PayloadFields value={v} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  const text = String(value);
  if (/^https?:\/\//.test(text))
    return (
      <a
        href={text}
        target="_blank"
        rel="noreferrer noopener"
        className="break-all text-[color:var(--color-g-blue)] underline decoration-dotted"
      >
        {text}
      </a>
    );
  return <span>{text}</span>;
}

function pick(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

function summarize(payload: Record<string, unknown>, entityType: string | null): string | null {
  if (entityType === "location") {
    const parts = [
      pick(payload, ["address", "street_address", "address_line_1"]),
      pick(payload, ["city", "locality", "search_city"]),
      pick(payload, ["state", "region", "search_state"]),
      pick(payload, ["postal_code", "zip", "zipcode"]),
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  const parts = [
    pick(payload, ["role", "title", "job_title", "position", "designation"]),
    pick(payload, ["office", "office_name", "sub_brand", "brand", "company"]),
    pick(payload, ["city", "locality", "search_city"]),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function PipelineTab() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ gcid: "", sourceId: "", status: "" });
  const [page, setPage] = useState(0);

  const { data: sourceRows = [] } = useQuery({
    queryKey: ["exp_etl_sources_for_staging_filters"],
    queryFn: () =>
      api.get<{ source_id: string; source_domain: string; gcid: string | null }[]>("/etl/console/pipeline/sources"),
  });

  // gcids present in staging (checked in the database per known gcid).
  const { data: stagingGcids = [] } = useQuery({
    queryKey: ["exp_etl_staging_gcids", sourceRows.length],
    enabled: sourceRows.length > 0,
    queryFn: () => {
      const gcids = [...new Set(sourceRows.map((s) => s.gcid).filter((g): g is string => !!g))].sort();
      return api.post<string[]>("/etl/console/pipeline/staging-gcids", { gcids });
    },
  });

  const sourceOptions = useMemo(
    () =>
      sourceRows
        .filter((s) => filters.gcid && s.gcid === filters.gcid)
        .sort((a, b) => (a.source_domain ?? "").localeCompare(b.source_domain ?? "")),
    [sourceRows, filters.gcid],
  );

  const setFilter = (patch: Partial<Filters>) => {
    setFilters((f) => {
      const next = { ...f, ...patch };
      if (patch.gcid !== undefined && patch.gcid !== f.gcid) next.sourceId = "";
      return next;
    });
    setPage(0);
    setExpanded(null);
  };

  const { data: counts = {} } = useQuery({
    queryKey: ["exp_etl_staging_counts", filters.gcid, filters.sourceId],
    // one count per FUNNEL status (gcid / source filters, not the status filter)
    queryFn: () =>
      api.post<Record<string, number>>("/etl/console/pipeline/funnel", {
        gcid: filters.gcid || null,
        source_id: filters.sourceId || null,
      }),
  });

  const { data: sources = {} } = useQuery({
    queryKey: ["exp_etl_sources_domains"],
    queryFn: async () => {
      const data = await api.get<{ source_id: string; source_domain: string }[]>("/etl/console/pipeline/source-domains");
      return Object.fromEntries(data.map((s) => [s.source_id, s.source_domain])) as Record<string, string>;
    },
  });

  const { data: pageData, isLoading } = useQuery({
    queryKey: ["exp_etl_staging_page", filters, page],
    queryFn: () =>
      api.post<{ rows: StageRow[]; total: number }>("/etl/console/pipeline/page", {
        gcid: filters.gcid || null,
        source_id: filters.sourceId || null,
        status: filters.status || null,
        page,
      }),
  });
  const rows = pageData?.rows ?? [];
  const total = pageData?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));


  const groups = useMemo(() => {
    const order = ["Intake", "Resolved", "Exceptions"];
    return order.map((g) => ({ group: g, stages: FUNNEL.filter((f) => f.group === g) }));
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-3">
        {groups.map(({ group, stages }) => (
          <div key={group} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {group}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
              {stages.map((s) => (
                <div key={s.key}>
                  <div className="text-3xl font-bold tabular-nums text-ink">
                    {(counts[s.key] ?? 0).toLocaleString()}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="text-xs text-slate-500">
          <div className="mb-1 font-semibold uppercase tracking-wider">Category</div>
          <select
            className="h-9 min-w-[220px] rounded-md border border-slate-200 bg-white px-2 text-sm text-ink"
            value={filters.gcid}
            onChange={(e) => setFilter({ gcid: e.target.value })}
          >
            <option value="">All categories</option>
            {stagingGcids.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1 font-semibold uppercase tracking-wider">Source</div>
          <select
            className="h-9 min-w-[220px] rounded-md border border-slate-200 bg-white px-2 text-sm text-ink disabled:opacity-50"
            value={filters.sourceId}
            disabled={!filters.gcid}
            onChange={(e) => setFilter({ sourceId: e.target.value })}
          >
            <option value="">{filters.gcid ? "All sources" : "Choose a category first"}</option>
            {sourceOptions.map((s) => (
              <option key={s.source_id} value={s.source_id}>
                {s.source_domain}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1 font-semibold uppercase tracking-wider">Status</div>
          <select
            className="h-9 min-w-[160px] rounded-md border border-slate-200 bg-white px-2 text-sm capitalize text-ink"
            value={filters.status}
            onChange={(e) => setFilter({ status: e.target.value })}
          >
            <option value="">All statuses</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-500">
          Each row is one harvested record. Name and summary come from the extracted payload; Fields
          shows how many data points were captured.
        </p>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5">Name</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Source</th>
                <th className="px-3 py-2.5">Fields</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Time</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                    Loading staging rows…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    The pipeline fills when harvesters run.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const open = expanded === r.stage_id;
                  const payload =
                    r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
                      ? (r.payload as Record<string, unknown>)
                      : {};
                  const identity =
                    r.identity_candidates && typeof r.identity_candidates === "object" && !Array.isArray(r.identity_candidates)
                      ? (r.identity_candidates as Record<string, unknown>)
                      : {};
                  const name = pick(identity, ["name"]) ?? pick(payload, ["name"]);
                  const isHarvest = "_contract" in payload || "_subjects" in payload;
                  const what = summarize(payload, r.entity_type);
                  const fieldCount = Object.keys(payload).filter((k) => !k.startsWith("_")).length;
                  const domain = r.source_id ? sources[r.source_id] : null;
                  return (
                    <Fragment key={r.stage_id}>
                      <tr
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                        onClick={() => setExpanded(open ? null : r.stage_id)}
                      >
                        <td className="px-3 py-2.5 align-top text-slate-400">
                          {open ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="font-semibold text-ink">{name ?? "Unnamed record"}</div>
                          {what ? (
                            <div className="mt-0.5 text-xs text-slate-500">{what}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <Badge
                            variant="secondary"
                            className="bg-slate-100 font-normal capitalize text-slate-600"
                          >
                            {r.entity_type ?? "—"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 align-top text-slate-600">
                          {domain ?? (
                            <span className="text-slate-400">manual/browser</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <Badge
                            variant="secondary"
                            className="bg-slate-100 font-normal tabular-nums text-slate-600"
                          >
                            {isHarvest
                              ? `T ${fieldCount} · S ${staticEntries(identity).length} · E ${extraEntries(payload).length}`
                              : `${fieldCount} fields`}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "font-normal capitalize",
                              STAGE_STATUS_STYLES[r.resolution_status ?? ""] ??
                                "bg-slate-100 text-slate-600",
                            )}
                          >
                            {r.resolution_status ?? "—"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 align-top text-xs text-slate-400">
                          {r.observed_at ? new Date(r.observed_at).toLocaleString() : "—"}
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td colSpan={7} className="px-6 py-4">
                            <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs text-slate-500">
                              <div>
                                <span className="font-semibold uppercase tracking-wider">
                                  Category
                                </span>
                                <div className="mt-0.5 font-mono text-slate-600">
                                  {r.gcid ?? "—"}
                                </div>
                              </div>
                              <div>
                                <span className="font-semibold uppercase tracking-wider">
                                  Field tier
                                </span>
                                <div className="mt-0.5 text-slate-600">{r.field_tier ?? "—"}</div>
                              </div>
                            </div>
                            {isHarvest ? (
                              <>
                                <ProfileSection title="Taxonomy" count={taxonomyCount(payload)}>
                                  <HarvestPayload payload={payload} />
                                </ProfileSection>
                                <ProfileSection title="Static" count={staticEntries(identity).length}>
                                  {staticEntries(identity).length ? (
                                    <FieldList items={staticEntries(identity)} />
                                  ) : (
                                    <span className="text-slate-400">No static fields</span>
                                  )}
                                </ProfileSection>
                                <ProfileSection title="Extra" count={extraEntries(payload).length}>
                                  {extraEntries(payload).length ? (
                                    <FieldList items={extraEntries(payload).map(([k, v]) => ({ label: k, subject: null, value: v }))} />
                                  ) : (
                                    <span className="text-slate-400">No extra fields</span>
                                  )}
                                </ProfileSection>
                              </>
                            ) : (
                              <>
                                <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                                  Extracted payload
                                </div>
                                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
                                  <PayloadFields value={r.payload ?? {}} />
                                </div>
                              </>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {total === 0
              ? "0 records"
              : `${(page * PAGE_SIZE + 1).toLocaleString()}–${Math.min(total, (page + 1) * PAGE_SIZE).toLocaleString()} of ${total.toLocaleString()} records`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-8 rounded-md border border-slate-200 bg-white px-3 text-sm text-ink disabled:opacity-40"
              disabled={page === 0}
              onClick={() => { setPage((p) => Math.max(0, p - 1)); setExpanded(null); }}
            >
              Previous
            </button>
            <span>
              Page {page + 1} of {pageCount}
            </span>
            <button
              type="button"
              className="h-8 rounded-md border border-slate-200 bg-white px-3 text-sm text-ink disabled:opacity-40"
              disabled={page + 1 >= pageCount}
              onClick={() => { setPage((p) => p + 1); setExpanded(null); }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
