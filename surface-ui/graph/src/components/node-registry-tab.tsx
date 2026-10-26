import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "@v3/state/api/server-fn";
import { Card, CardContent } from "@v3/shared/components/ui/card";
import { Button } from "@v3/shared/components/ui/button";
import { ModelLock } from "@v3/shared/components/ui/model-lock";
import { Input } from "@v3/shared/components/ui/input";
import { Textarea } from "@v3/shared/components/ui/textarea";
import { Label } from "@v3/shared/components/ui/label";
import { Badge } from "@v3/shared/components/ui/badge";
import { Checkbox } from "@v3/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v3/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/shared/components/ui/select";
import { cn } from "@v3/shared/components/utils/utils";

type NodeRow = {
  id: string;
  gcid: string;
  node_name: string;
  node_slug: string;
  node_description: string | null;
  ring: string;
  entity_scope: string | null;
  connection_method: string | null;
  schema_type: string | null;
  schema_property: string | null;
  required_for_score: boolean | null;
  score_points: number | null;
  priority: number | null;
  url_pattern: string | null;
  url_example: string | null;
  compliance_notes: string | null;
  is_active: boolean | null;
  notes: string | null;
};

type RingDef = {
  slug: string;
  index: number;
  label: string;
  seo?: string;
  nodeTypes?: string[];
  nodeKeys: string[];
  writeKey: string;
};

// Canonical 13-ring model (locked). Used as fallback + to guarantee media/social/
// transactions render even when exp_rings still has the legacy 10-row seed.
const CANONICAL_13: {
  key: string;
  label: string;
  seo: string;
}[] = [
  { key: "identity",     label: "Identity",     seo: "Who you are — resolves to the schema.org root type." },
  { key: "presence",     label: "Presence",     seo: "Where the entity exists on the open web (profiles, sameAs)." },
  { key: "location",     label: "Location",     seo: "Physical footprint and served-area geography." },
  { key: "authority",    label: "Authority",    seo: "Credentials, licenses, accreditations, memberships." },
  { key: "services",     label: "Services",     seo: "Offered services, products, and specializations." },
  { key: "content",      label: "Content",      seo: "Published pages, articles, and long-form owned content." },
  { key: "media",        label: "Media",        seo: "Photos, videos, and audio assets tied to the entity." },
  { key: "reputation",   label: "Reputation",   seo: "Reviews, ratings, and third-party attestations." },
  { key: "social",       label: "Social",       seo: "Social presence and syndicated posts." },
  { key: "engagement",   label: "Engagement",   seo: "Two-way interactions — Q&A, DMs, event RSVPs." },
  { key: "conversion",   label: "Conversion",   seo: "Actions the profile can perform — potentialAction." },
  { key: "transactions", label: "Transactions", seo: "Completed outcomes and transactional history." },
  { key: "entity_graph", label: "Entity graph", seo: "Upstream/downstream entity linkages and sameAs anchors." },
];

// Canonical ring_key -> legacy node.ring values it absorbs.
const CANONICAL_NODE_KEYS: Record<string, string[]> = {
  identity: ["identity", "core_identity"],
  presence: ["presence", "profiles_presence"],
  location: ["location"],
  authority: ["authority", "verifiable_authority"],
  services: ["services"],
  content: ["content", "published_content"],
  media: ["media", "media_voice"],
  reputation: ["reputation"],
  social: ["social", "social_engagement"],
  engagement: ["engagement"],
  conversion: ["conversion"],
  transactions: ["transactions", "transactions_outcomes"],
  entity_graph: ["entity_graph", "context", "upstream_context"],
};

const LEGACY_RINGS: RingDef[] = CANONICAL_13.map((r, i) => ({
  slug: r.key,
  index: i + 1,
  label: r.label,
  seo: r.seo,
  nodeKeys: CANONICAL_NODE_KEYS[r.key] ?? [r.key],
  writeKey: r.key,
}));

const CONNECTION_METHODS = [
  "oauth",
  "etl",
  "crm_sync",
  "manual",
  "rss",
  "platform",
] as const;

function methodTone(m: string | null | undefined) {
  switch (m) {
    case "oauth":
      return "bg-violet-100 text-violet-800";
    case "etl":
      return "bg-blue-100 text-blue-800";
    case "crm_sync":
      return "bg-cyan-100 text-cyan-800";
    case "manual":
      return "bg-slate-100 text-slate-700";
    case "rss":
      return "bg-amber-100 text-amber-800";
    case "platform":
      return "bg-emerald-100 text-emerald-800";
    default:
      return "bg-slate-100 text-slate-500";
  }
}

type FormState = {
  node_name: string;
  node_slug: string;
  node_description: string;
  ring: string;
  connection_method: string;
  schema_type: string;
  schema_property: string;
  required_for_score: boolean;
  score_points: number;
  priority: number;
  url_pattern: string;
  url_example: string;
  compliance_notes: string;
  is_active: boolean;
  notes: string;
};

function emptyForm(ring: string, priority = 0): FormState {
  return {
    node_name: "",
    node_slug: "",
    node_description: "",
    ring,
    connection_method: "manual",
    schema_type: "",
    schema_property: "",
    required_for_score: false,
    score_points: 0,
    priority,
    url_pattern: "",
    url_example: "",
    compliance_notes: "",
    is_active: true,
    notes: "",
  };
}

function fromRow(r: NodeRow): FormState {
  return {
    node_name: r.node_name ?? "",
    node_slug: r.node_slug ?? "",
    node_description: r.node_description ?? "",
    ring: r.ring,
    connection_method: r.connection_method ?? "manual",
    schema_type: r.schema_type ?? "",
    schema_property: r.schema_property ?? "",
    required_for_score: !!r.required_for_score,
    score_points: r.score_points ?? 0,
    priority: r.priority ?? 0,
    url_pattern: r.url_pattern ?? "",
    url_example: r.url_example ?? "",
    compliance_notes: r.compliance_notes ?? "",
    is_active: r.is_active ?? true,
    notes: r.notes ?? "",
  };
}

export function NodeRegistryTab({ gcid }: { gcid: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ row: NodeRow | null; ring: string } | null>(
    null,
  );
  const [scopeFilter, setScopeFilter] = useState<"all" | "professional" | "location" | "shared">("all");

  // Canonical rings from exp_rings (locked 2026-07-05). Falls back to the legacy
  // vocabulary if the table hasn't been applied yet, so the tab never breaks.
  const { data: canonRings = null } = useQuery({
    queryKey: ["exp-rings"],
    queryFn: async () => {
      // the read's error fell back to the legacy vocabulary (null)
      const data = await api.get<unknown>("/graph/categories/rings").catch(() => null);
      return data as {
        position: number;
        ring_key: string;
        ring_name: string;
        legacy_key: string | null;
        seo_function: string;
        schema_types: string[] | null;
      }[] | null;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Category entity_type (governs whether Person appears anywhere in this category)
  const { data: km = null } = useQuery({
    queryKey: ["category-entity-type", gcid],
    queryFn: async () => {
      // `.maybeSingle()` whose error was ignored: null (also when the category has 2 rows)
      const data = await api
        .get<unknown>("/graph/categories/entity-type", { params: { gcid } })
        .catch(() => null);
      return (data as { entity_type: string | null } | null);
    },
    staleTime: 5 * 60 * 1000, retry: false,
  });

  // Category -> schema.org type (exp_category_schema_type; 99.8% coverage)
  const { data: schemaType = null } = useQuery({
    queryKey: ["category-schema-type", gcid],
    queryFn: async () => {
      const data = await api.get<unknown>("/graph/categories/schema-type", { params: { gcid } }).catch(() => null);
      return data as { schema_type: string | null; confidence: string | null } | null;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const rings: RingDef[] = useMemo(() => {
    // Always render all 13 canonical rings. Enrich with exp_rings metadata (SEO,
    // schema.org chip hints) when available; fall back to hardcoded label/seo
    // for any ring not yet in the seeded table (media/social/transactions).
    const isLocation = km?.entity_type === "location";
    const catType = schemaType?.schema_type ?? null;
    const resolveChips = (ringKey: string, universal: string[] | null | undefined): string[] | undefined => {
      let chips = universal ? [...universal] : undefined;
      if (!chips) return chips;
      if (isLocation) chips = chips.filter((t) => t !== "Person");
      if (ringKey === "identity" && catType) {
        chips = [catType, ...chips.filter((t) => t !== catType && t !== "Organization" && t !== "Corporation")];
      }
      return chips;
    };
    const canonMap = new Map((canonRings ?? []).map((r) => [r.ring_key, r]));
    return CANONICAL_13.map((r, i) => {
      const c = canonMap.get(r.key);
      return {
        slug: r.key,
        index: i + 1,
        label: c?.ring_name ?? r.label,
        seo: c?.seo_function ?? r.seo,
        nodeTypes: resolveChips(r.key, c?.schema_types ?? null),
        nodeKeys: CANONICAL_NODE_KEYS[r.key] ?? [r.key],
        writeKey: r.key,
      } as RingDef;
    });
  }, [canonRings, km?.entity_type, schemaType?.schema_type]);


  // Ring-mapped schema properties for this category's type (computed intersection)
  const { data: ringMap = [] } = useQuery({
    queryKey: ["schema-ring-map", schemaType?.schema_type],
    enabled: !!schemaType?.schema_type,
    queryFn: async () => {
      const data = await api
        .get<unknown[]>("/graph/categories/schema-ring-map", { params: { schema_type: schemaType!.schema_type! } })
        .catch(() => [] as unknown[]);
      return (data ?? []) as { ring_key: string; schema_property: string; inherited_from: string }[];
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const mappedByRing = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const row of ringMap) {
      (m[row.ring_key] ??= []).push(row.schema_property);
    }
    for (const k of Object.keys(m)) m[k].sort();
    return m;
  }, [ringMap]);

  const { data: nodes = [], isLoading } = useQuery({
    queryKey: ["node-registry", gcid],
    queryFn: async () => {
      const data = await api.get<NodeRow[]>("/graph/categories/node-registry", { params: { gcid } });
      return (data ?? []) as NodeRow[];
    },
  });

  // Data Model Contract: a lane view shows nodes of that lane PLUS shared nodes
  // (shared = present in BOTH lanes, each entity fills its own value).
  const filteredNodes = useMemo(() => {
    if (scopeFilter === "all") return nodes;
    return nodes.filter((n) => {
      const s = (n.entity_scope ?? "shared").toLowerCase();
      return s === scopeFilter || s === "shared";
    });
  }, [nodes, scopeFilter]);

  const byRing = useMemo(() => {
    const m: Record<string, NodeRow[]> = {};
    for (const r of rings) {
      m[r.slug] = filteredNodes.filter((n) => r.nodeKeys.includes(n.ring));
      m[r.slug].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    }
    return m;
  }, [filteredNodes, rings]);

  const summary = useMemo(() => {
    const total = filteredNodes.length;
    const required = filteredNodes.filter((n) => n.required_for_score).length;
    const points = filteredNodes.reduce((s, n) => s + (n.score_points ?? 0), 0);
    const methods: Record<string, number> = {};
    for (const n of filteredNodes) {
      const m = n.connection_method ?? "—";
      methods[m] = (methods[m] ?? 0) + 1;
    }
    const ringsCovered = rings.filter((r) => (byRing[r.slug]?.length ?? 0) > 0).length;
    return { total, required, points, methods, ringsCovered, ringCount: rings.length };
  }, [filteredNodes, rings, byRing]);

  const reorder = useMutation({
    mutationFn: async (updates: { id: string; priority: number }[]) => {
      // one update per row, in order, stopping at the first error (server side)
      await api.post("/graph/categories/node-registry/reorder", { updates });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["node-registry", gcid] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/graph/categories/node-registry/${encodeURIComponent(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["node-registry", gcid] }),
  });

  const handleDrop = (ringSlug: string, targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const list = byRing[ringSlug];
    const fromIdx = list.findIndex((n) => n.id === dragId);
    const toIdx = list.findIndex((n) => n.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...list];
    const [item] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, item);
    const updates = next.map((n, i) => ({ id: n.id, priority: i + 1 }));
    reorder.mutate(updates);
    setDragId(null);
  };

  if (isLoading) {
    return <div className="text-sm text-slate-500 p-4">Loading nodes…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <Card>
        <CardContent className="py-4">
          {schemaType?.schema_type && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs uppercase tracking-wide text-slate-500">schema.org type</span>
              <Badge variant="secondary" className="font-mono bg-indigo-50 text-indigo-700">
                {schemaType.schema_type}
              </Badge>
              {schemaType.confidence && (
                <span className="text-xs text-slate-400">{schemaType.confidence} confidence · vocabulary-validated</span>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-4">
            <Stat label="Total nodes" value={summary.total} />
            <Stat label="Required nodes" value={summary.required} />
            <Stat label="Total score points" value={summary.points} />
            <Stat label="Connection methods" value={Object.keys(summary.methods).length} />
            <Stat
              label="Rings covered"
              value={summary.ringsCovered}
              suffix={` of ${summary.ringCount}`}
            />
            <Stat label="Mapped properties" value={ringMap.length} />
          </div>
          <div className="flex flex-wrap gap-1.5 pt-3 border-t">
            {Object.entries(summary.methods)
              .sort((a, b) => b[1] - a[1])
              .map(([m, c]) => (
                <Badge
                  key={m}
                  variant="secondary"
                  className={cn("font-normal", methodTone(m))}
                >
                  {m}: {c}
                </Badge>
              ))}
            {summary.total === 0 && (
              <span className="text-xs text-slate-400">No nodes yet.</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Lane filter */}
      <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-2.5">
        <span className="text-xs text-slate-500 uppercase tracking-wide">Lane</span>
        <div className="flex gap-1">
          {(["all", "professional", "location", "shared"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScopeFilter(s)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium border transition-colors capitalize",
                scopeFilter === s
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 text-slate-600 hover:border-slate-400",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-400">
          {filteredNodes.length} of {nodes.length} nodes shown
        </span>
      </div>

      {/* Ring sections */}
      {rings.map((r) => {
        const list = byRing[r.slug] ?? [];
        const isOpen = open[r.slug] ?? true;
        return (
          <Card key={r.slug}>
            <button
              type="button"
              onClick={() => setOpen({ ...open, [r.slug]: !isOpen })}
              className="w-full flex items-center justify-between px-5 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                )}
                <span className="min-w-0 text-left">
                  <span className="block text-sm font-semibold text-slate-900">
                    Ring {r.index} — {r.label}
                  </span>
                  {r.seo && (
                    <span className="block text-xs text-slate-400 truncate">
                      {r.seo}
                    </span>
                  )}
                </span>
                <Badge variant="secondary" className="bg-slate-100 text-slate-600 ml-2">
                  {list.length}
                </Badge>
              </div>
              <span onClick={(e) => e.stopPropagation()}>
                <ModelLock label="Add locked" />
              </span>
            </button>

            {isOpen && (
              <CardContent className="p-0">
                {(r.nodeTypes ?? []).length > 0 && (
                  <div className="px-5 py-2.5 border-b border-slate-100">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">
                      Graph node types ({(r.nodeTypes ?? []).length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(r.nodeTypes ?? []).map((t) => (
                        <span
                          key={t}
                          className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-100 text-indigo-700"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {(mappedByRing[r.slug] ?? []).length > 0 && (
                  <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">
                      Mapped schema properties ({(mappedByRing[r.slug] ?? []).length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(mappedByRing[r.slug] ?? []).map((p) => (
                        <span
                          key={p}
                          className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {list.length === 0 ? (
                  <div className="px-5 py-6 text-sm text-slate-400">
                    {r.seo
                      ? `No nodes yet — this ring covers: ${r.seo}.`
                      : "No nodes registered in this ring."}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="text-left px-3 py-2 w-12">#</th>
                          <th className="text-left px-3 py-2">Node</th>
                          <th className="text-left px-3 py-2">Connection</th>
                          <th className="text-left px-3 py-2">Schema</th>
                          <th className="text-left px-3 py-2">Required</th>
                          <th className="text-left px-3 py-2">Points</th>
                          <th className="text-left px-3 py-2">URL pattern</th>
                          <th className="text-right px-3 py-2 w-24">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((n) => (
                          <tr
                            key={n.id}
                            className={cn(
                              "border-t border-slate-100 hover:bg-slate-50",
                              dragId === n.id && "opacity-50",
                            )}
                          >
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1 text-slate-400">
                                <GripVertical className="h-3.5 w-3.5 cursor-grab" />
                                <span className="text-xs">{n.priority ?? "—"}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="font-medium text-slate-900">{n.node_name}</div>
                                {n.entity_scope && n.entity_scope !== "shared" && (
                                  <Badge
                                    variant="secondary"
                                    className={cn(
                                      "text-[10px] font-normal",
                                      n.entity_scope === "professional"
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-blue-100 text-blue-800",
                                    )}
                                  >
                                    {n.entity_scope}
                                  </Badge>
                                )}
                                {scopeFilter !== "all" &&
                                  (n.entity_scope ?? "shared").toLowerCase() === "shared" && (
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] font-normal bg-slate-100 text-slate-600"
                                      title="Shared node — exists in both lanes; each entity fills its own value"
                                    >
                                      shared
                                    </Badge>
                                  )}
                              </div>
                              {n.node_slug && (
                                <div className="text-xs text-slate-400 font-mono">
                                  {n.node_slug}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <Badge
                                variant="secondary"
                                className={cn("font-normal", methodTone(n.connection_method))}
                              >
                                {n.connection_method ?? "—"}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-slate-700">
                              <div className="font-mono text-xs">{n.schema_type ?? "—"}</div>
                              {n.schema_property && (
                                <div className="text-xs text-slate-400 font-mono">
                                  {n.schema_property}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {n.required_for_score ? (
                                <Badge className="bg-emerald-100 text-emerald-800 font-normal">
                                  Required
                                </Badge>
                              ) : (
                                <span className="text-slate-400 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-700">
                              {n.score_points ?? 0}
                            </td>
                            <td className="px-3 py-2 max-w-[240px]">
                              <div className="font-mono text-xs text-slate-500 truncate">
                                {n.url_pattern ?? "—"}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex items-center gap-1">
                                <ModelLock label="Locked" />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}

      {editing && (
        <NodeEditDialog
          gcid={gcid}
          ring={editing.ring}
          row={editing.row}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["node-registry", gcid] });
            qc.invalidateQueries({ queryKey: ["category-detail", gcid] });
            setEditing(null);
          }}
          nextPriority={nodes.filter((n) => n.ring === editing.ring).length + 1}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold text-slate-900 mt-1">
        {value}
        {suffix && (
          <span className="text-sm font-normal text-slate-400">{suffix}</span>
        )}
      </div>
    </div>
  );
}

function NodeEditDialog({
  gcid,
  ring,
  row,
  onClose,
  onSaved,
  nextPriority,
}: {
  gcid: string;
  ring: string;
  row: NodeRow | null;
  onClose: () => void;
  onSaved: () => void;
  nextPriority: number;
}) {
  const [form, setForm] = useState<FormState>(() =>
    row ? fromRow(row) : { ...emptyForm(ring, nextPriority) },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (row) {
        await api.patch(`/graph/categories/node-registry/${encodeURIComponent(row.id)}`, {
          node_name: form.node_name,
          node_slug: form.node_slug,
          node_description: form.node_description || null,
          ring: form.ring,
          connection_method: form.connection_method,
          schema_type: form.schema_type || null,
          schema_property: form.schema_property || null,
          required_for_score: form.required_for_score,
          score_points: form.score_points,
          priority: form.priority,
          url_pattern: form.url_pattern || null,
          url_example: form.url_example || null,
          compliance_notes: form.compliance_notes || null,
          is_active: form.is_active,
          notes: form.notes || null,
        });
      } else {
        await api.post("/graph/categories/node-registry", {
          gcid,
          node_name: form.node_name,
          node_slug: form.node_slug,
          node_description: form.node_description || null,
          ring: form.ring,
          connection_method: form.connection_method,
          schema_type: form.schema_type || null,
          schema_property: form.schema_property || null,
          required_for_score: form.required_for_score,
          score_points: form.score_points,
          priority: form.priority,
          url_pattern: form.url_pattern || null,
          url_example: form.url_example || null,
          compliance_notes: form.compliance_notes || null,
          is_active: form.is_active,
          notes: form.notes || null,
        });
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row ? "Edit node" : "Add node"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Node name">
            <Input
              value={form.node_name}
              onChange={(e) => setForm({ ...form, node_name: e.target.value })}
            />
          </Field>
          <Field label="Node slug">
            <Input
              value={form.node_slug}
              onChange={(e) => setForm({ ...form, node_slug: e.target.value })}
              className="font-mono text-sm"
            />
          </Field>

          <Field label="Ring">
            <Select value={form.ring} onValueChange={(v) => setForm({ ...form, ring: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEGACY_RINGS.map((r) => (
                  <SelectItem key={r.slug} value={r.slug}>
                    Ring {r.index} — {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Connection method">
            <Select
              value={form.connection_method}
              onValueChange={(v) => setForm({ ...form, connection_method: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONNECTION_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Schema type">
            <Input
              value={form.schema_type}
              onChange={(e) => setForm({ ...form, schema_type: e.target.value })}
              placeholder="Person, Organization…"
            />
          </Field>
          <Field label="Schema property">
            <Input
              value={form.schema_property}
              onChange={(e) => setForm({ ...form, schema_property: e.target.value })}
              placeholder="sameAs, hasCredential…"
            />
          </Field>

          <Field label="Priority">
            <Input
              type="number"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
            />
          </Field>
          <Field label="Score points">
            <Input
              type="number"
              value={form.score_points}
              onChange={(e) => setForm({ ...form, score_points: Number(e.target.value) })}
            />
          </Field>

          <Field label="URL pattern" className="md:col-span-2">
            <Input
              value={form.url_pattern}
              onChange={(e) => setForm({ ...form, url_pattern: e.target.value })}
              className="font-mono text-sm"
              placeholder="https://example.com/{slug}"
            />
          </Field>
          <Field label="URL example" className="md:col-span-2">
            <Input
              value={form.url_example}
              onChange={(e) => setForm({ ...form, url_example: e.target.value })}
              className="font-mono text-sm"
            />
          </Field>

          <Field label="Description" className="md:col-span-2">
            <Textarea
              value={form.node_description}
              onChange={(e) => setForm({ ...form, node_description: e.target.value })}
              rows={2}
            />
          </Field>

          <Field label="Compliance notes" className="md:col-span-2">
            <Textarea
              value={form.compliance_notes}
              onChange={(e) => setForm({ ...form, compliance_notes: e.target.value })}
              rows={2}
            />
          </Field>

          <Field label="Notes" className="md:col-span-2">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </Field>

          <div className="flex items-center gap-3 md:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.required_for_score}
                onCheckedChange={(v) =>
                  setForm({ ...form, required_for_score: v === true })
                }
              />
              Required for score
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v === true })}
              />
              Active
            </label>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || !form.node_name || !form.node_slug || !form.ring}
          >
            {saving ? "Saving…" : row ? "Save changes" : "Create node"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-xs text-slate-600">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
