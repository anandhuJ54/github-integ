import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import { EmpLayout } from "@v3/shared/components/ui/emp-layout";
import { KnowledgeModelTab } from "@v3/graph/components/knowledge-model-tab";
import { NodeRegistryTab } from "@v3/graph/components/node-registry-tab";
import { TaxonomyTab } from "@v3/graph/components/taxonomy-tab";
import { ComplianceTab } from "@v3/graph/components/compliance-tab";
import { ListingsTab } from "@v3/graph/components/listings-tab";
import { OperationsTab } from "@v3/graph/components/operations-tab";
import { ScoringTab } from "@v3/graph/components/scoring-tab";
import { AiConfigTab } from "@v3/graph/components/ai-config-tab";
import { SchemaTab } from "@v3/graph/components/schema-tab";
import { api } from "@v3/state/api/server-fn";
import { Card, CardContent, CardHeader, CardTitle } from "@v3/shared/components/ui/card";
import { Badge } from "@v3/shared/components/ui/badge";
import { Button } from "@v3/shared/components/ui/button";
import { Switch } from "@v3/shared/components/ui/switch";
import { Label } from "@v3/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/shared/components/ui/select";
import { cn } from "@v3/shared/components/utils/utils";
import { getCategoryRelationships } from "@v3/graph/utils/category-relationships";
import { getCategorySchema } from "@v3/graph/utils/expertise-schema";

export const Route = createFileRoute("/_authenticated/categories/$gcid")({
  component: CategoryDetailPage,
});

// ─── LAYER PIPELINE ───────────────────────────────────────────────────────────
// Canonical build sequence — each layer feeds the next (foundation first).
// Compliance, Scoring and AI Config are governance tabs, not build layers.

const LAYER_TABS = [
  { num: 1, label: "Knowledge Model", tab: "Knowledge Model", dot: "bg-blue-500 text-white",    desc: "Core intelligence model" },
  { num: 2, label: "Taxonomy",        tab: "Taxonomy",         dot: "bg-violet-500 text-white",  desc: "Terms + position in the GBP tree" },
  { num: 3, label: "Node Registry",   tab: "Node Registry",    dot: "bg-emerald-500 text-white", desc: "Expertise-graph nodes (8 rings)" },
  { num: 4, label: "Schema",          tab: "Schema",           dot: "bg-slate-500 text-white",   desc: "schema.org contract → profile, HTML, SEO" },
] as const;

// All tabs in canonical order: 4 build layers, then governance.
const TABS = [
  "Overview",
  "Knowledge Model",
  "Taxonomy",
  "Node Registry",
  "Schema",
  "Compliance",
  "Operations",
  "Listings",
  "Scoring",
  "AI Config",
] as const;

type TabName = (typeof TABS)[number];

// ─── DATA FETCHING ────────────────────────────────────────────────────────────

type DetailRows = {
  category: any;
  knowledge: any[] | null;
  compliance: any;
  nodes: any[] | null;
  taxonomy: any[] | null;
  uiConfigs: any[] | null;
  directories: any[] | null;
  secondaries: any[] | null;
  groups: any[] | null;
  validation: any[] | null;
};

async function fetchDetail(gcid: string) {
  // The ten reads in one request; a read whose error the page ignored comes back null.
  const res = await api.get<DetailRows>("/graph/categories/detail", { params: { gcid } });
  const cat = { data: res.category }, know = { data: res.knowledge }, comp = { data: res.compliance };
  const nodes = { data: res.nodes }, tax = { data: res.taxonomy }, ui = { data: res.uiConfigs };
  const dirs = { data: res.directories }, secs = { data: res.secondaries };
  const groups = { data: res.groups }, validation = { data: res.validation };
  const ringCounts: Record<string, number> = {};
  const scopeCounts: Record<string, number> = {};
  for (const n of nodes.data ?? []) {
    const r = (n as any).ring ?? "—";
    const s = (n as any).entity_scope ?? "shared";
    ringCounts[r] = (ringCounts[r] ?? 0) + 1;
    scopeCounts[s] = (scopeCounts[s] ?? 0) + 1;
  }
  return {
    category: cat.data,
    knowledge: (know.data ?? []) as any[],
    compliance: comp.data,
    ringCounts,
    scopeCounts,
    totalNodes: nodes.data?.length ?? 0,
    hasTaxonomy: (tax.data?.length ?? 0) > 0,
    uiConfigs: (ui.data ?? []) as any[],
    directories: (dirs.data ?? []) as any[],
    secondaries: (secs.data ?? []) as any[],
    groups: (groups.data ?? []) as any[],
    validation: (validation.data ?? []) as { check_code: string; passed: boolean; detail: string }[],
  };
}

// ─── SMALL COMPONENTS ────────────────────────────────────────────────────────

function EntityBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <Badge variant="secondary">—</Badge>;
  const v = value.toLowerCase();
  const tone =
    v === "both"
      ? "bg-violet-100 text-violet-800"
      : v === "location"
        ? "bg-blue-100 text-blue-800"
        : v === "professional" || v === "person"
          ? "bg-emerald-100 text-emerald-800"
          : "bg-slate-100 text-slate-700";
  return <Badge variant="secondary" className={tone}>{value}</Badge>;
}

function YesNo({ value }: { value: boolean | null | undefined }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  return (
    <Badge variant="secondary" className={value ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}>
      {value ? "Yes" : "No"}
    </Badge>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
      {children}
    </span>
  );
}

/** 4-dot build-layer pipeline shown in the page header. */
function LayerPipelineDots({
  hasKnowledge, hasTaxonomy, hasNodes, hasSchema,
}: {
  hasKnowledge: boolean; hasTaxonomy: boolean; hasNodes: boolean; hasSchema: boolean;
}) {
  const done = [hasKnowledge, hasTaxonomy, hasNodes, hasSchema];
  return (
    <div className="flex items-center gap-1.5">
      {LAYER_TABS.map((l, i) => (
        <div key={l.num} className="flex items-center gap-1">
          <div
            title={`${l.label}: ${done[i] ? "built" : "not built"}`}
            className={cn(
              "w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold",
              done[i] ? l.dot : "bg-slate-100 text-slate-400",
            )}
          >
            {l.num}
          </div>
          {i < LAYER_TABS.length - 1 && (
            <div className={`w-3 h-px ${done[i] && done[i + 1] ? "bg-slate-400" : "bg-slate-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

function CategoryDetailPage() {
  const { gcid } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabName>("Overview");

  const { data, isLoading } = useQuery({
    queryKey: ["category-detail", gcid],
    queryFn: () => fetchDetail(gcid),
  });

  const updateCategory = useMutation({
    mutationFn: async (patch: { status?: string; supports_single_pro_office?: boolean }) => {
      await api.patch("/graph/categories/category", { gcid, ...patch });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["category-detail", gcid] });
      qc.invalidateQueries({ queryKey: ["categories-intelligence"] });
    },
  });

  const rel = data?.category
    ? getCategoryRelationships(gcid, (data.category as any).display_name ?? "")
    : null;
  const childrenQ = useQuery({
    queryKey: ["category-children", gcid],
    enabled: (rel?.childrenGcids?.length ?? 0) > 0,
    queryFn: async () => {
      const ids = rel?.childrenGcids ?? [];
      // the read's error was ignored (no rows)
      const kids = await api
        .post<any[]>("/graph/categories/children", { gcids: ids, view: "detail" })
        .catch(() => null);
      return (kids ?? []) as Array<any>;
    },
  });

  if (isLoading || !data) {
    return (
      <EmpLayout>
        <div className="p-8 text-slate-500">Loading…</div>
      </EmpLayout>
    );
  }

  if (!data.category) {
    return (
      <EmpLayout>
        <div className="p-8">
          <Link
            to="/categories"
            className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-4 w-4" /> Back to categories
          </Link>
          <p className="mt-6 text-slate-500">Category not found.</p>
        </div>
      </EmpLayout>
    );
  }

  const cat = data.category as any;
  const knowRows = (data.knowledge as any[]) ?? [];
  const comp = data.compliance as any | null;

  // Derive effective entity_type from rows: two rows → "both" (composed);
  // one row keeps its own entity_type; zero rows → null.
  const effectiveEntityType =
    knowRows.length >= 2
      ? "both"
      : knowRows[0]?.entity_type ?? cat.entity_type ?? null;
  const legacyBothShape =
    knowRows.length === 1 && knowRows[0]?.entity_type === "both";

  const primaryKnow = knowRows[0] ?? null;
  const aiAgents = primaryKnow?.ai_agents ?? null;
  const sdrTone =
    aiAgents?.sdr_tone ?? aiAgents?.sdr?.tone ?? aiAgents?.notes?.sdr_tone ?? null;
  const complianceRestrictions =
    aiAgents?.compliance_restrictions ?? aiAgents?.notes?.compliance_restrictions ?? null;

  const regulatedBy: string[] = Array.isArray(comp?.regulated_by) ? comp.regulated_by : [];
  const ringEntries = Object.entries(data.ringCounts).sort(([a], [b]) => a.localeCompare(b));

  // Which build layers are complete (for the header pipeline dots)
  const layerBuilt = {
    hasKnowledge: knowRows.length > 0,
    hasTaxonomy: data.hasTaxonomy,
    hasNodes: data.totalNodes > 0,
    hasSchema: !!getCategorySchema(gcid) || data.totalNodes > 0,
  };

  const validationRows = data.validation ?? [];
  const validationPassed = validationRows.filter((v) => v.passed).length;

  return (
    <EmpLayout>
      <div className="max-w-[1400px] mx-auto p-8">

        {/* Back */}
        <Link
          to="/categories"
          className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back to categories
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">
              {cat.display_name}
            </h2>
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="font-mono text-xs">
                {cat.gcid}
              </Badge>
              <EntityBadge value={effectiveEntityType} />
              {legacyBothShape && (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-[10px]">
                  legacy knowledge shape
                </Badge>
              )}
              {/* 6-layer pipeline summary */}
              <LayerPipelineDots {...layerBuilt} />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-slate-200 mb-6">
          <nav className="flex gap-0.5 overflow-x-auto">
            {TABS.map((t) => {
              // Build-layer tabs get a numbered, status-colored badge prefix.
              const layerMeta = LAYER_TABS.find(l => l.tab === t);
              const builtByTab: Record<string, boolean> = {
                "Knowledge Model": layerBuilt.hasKnowledge,
                "Taxonomy": layerBuilt.hasTaxonomy,
                "Node Registry": layerBuilt.hasNodes,
                "Schema": layerBuilt.hasSchema,
              };
              const active = activeTab === t;

              return (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={cn(
                    "px-3.5 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5",
                    active
                      ? "border-slate-900 text-slate-900"
                      : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300",
                  )}
                >
                  {layerMeta && (
                    <span
                      className={cn(
                        "w-4 h-4 rounded text-[8px] font-bold flex items-center justify-center",
                        builtByTab[t] ? layerMeta.dot : "bg-slate-100 text-slate-400",
                      )}
                    >
                      {layerMeta.num}
                    </span>
                  )}
                  {t}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab content */}
        {activeTab === "Knowledge Model" ? (
          <KnowledgeModelTab gcid={gcid} knowledge={knowRows} />
        ) : activeTab === "Taxonomy" ? (
          <TaxonomyTab gcid={gcid} />
        ) : activeTab === "Node Registry" ? (
          <NodeRegistryTab gcid={gcid} />
        ) : activeTab === "Compliance" ? (
          <ComplianceTab gcid={gcid} />
        ) : activeTab === "Operations" ? (
          <OperationsTab gcid={gcid} />
        ) : activeTab === "Listings" ? (
          <ListingsTab gcid={gcid} entityType={cat.entity_type} />
        ) : activeTab === "Schema" ? (
          <SchemaTab
            gcid={gcid}
            displayName={cat.display_name ?? gcid}
            entityType={cat.entity_type}
            totalNodes={data.totalNodes}
            hasNodes={data.totalNodes > 0}
          />
        ) : activeTab === "Scoring" ? (
          <ScoringTab gcid={gcid} />
        ) : activeTab === "AI Config" ? (
          <AiConfigTab gcid={gcid} />
        ) : (
          /* ── Overview ──────────────────────────────────────────────────────── */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Left column */}
            <div className="lg:col-span-1 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Single Pro Office supported</Label>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Allow one professional per office node.
                      </p>
                    </div>
                    <Switch
                      checked={!!cat.supports_single_pro_office}
                      onCheckedChange={v =>
                        updateCategory.mutate({ supports_single_pro_office: v })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Status</Label>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Active or excluded from the platform.
                      </p>
                    </div>
                    <Select
                      value={cat.status ?? "active"}
                      onValueChange={v => updateCategory.mutate({ status: v })}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="excluded">Excluded</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="pt-4 border-t">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-sm">Market estimate (US)</Label>
                      {rel && (
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap",
                            rel.role === "specialization"
                              ? "bg-amber-100 text-amber-700"
                              : rel.role === "lane"
                                ? "bg-violet-100 text-violet-700"
                                : "bg-sky-100 text-sky-700",
                          )}
                        >
                          {rel.badge}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <div className="bg-slate-50 rounded-md p-2">
                        <div className="text-base font-semibold text-slate-900 tabular-nums">
                          {(cat as any).estimated_profiles != null ? Number((cat as any).estimated_profiles).toLocaleString() : "—"}
                        </div>
                        <div className="text-[11px] text-slate-500">profiles</div>
                      </div>
                      <div className="bg-slate-50 rounded-md p-2">
                        <div className="text-base font-semibold text-slate-900 tabular-nums">
                          {(cat as any).estimated_locations != null ? Number((cat as any).estimated_locations).toLocaleString() : "—"}
                        </div>
                        <div className="text-[11px] text-slate-500">locations</div>
                      </div>
                      <div className="bg-slate-50 rounded-md p-2">
                        <div className="text-base font-semibold text-slate-900 capitalize">
                          {(cat as any).us_relevance ?? "—"}
                        </div>
                        <div className="text-[11px] text-slate-500">US relevance</div>
                      </div>
                    </div>
                    {rel && (
                      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                        {rel.overlapNote}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {rel && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Relationships &amp; overlap</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Role</span>
                      <Badge variant="secondary" className="capitalize bg-slate-100 text-slate-700">
                        {rel.role}
                      </Badge>
                    </div>
                    {rel.parent && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Specialization of</span>
                        <Link
                          to="/categories/$gcid"
                          params={{ gcid: rel.parent.gcid }}
                          className="text-emerald-700 hover:underline font-medium"
                        >
                          {rel.parent.name} →
                        </Link>
                      </div>
                    )}
                    {rel.role === "head" && rel.childrenCount != null && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Specializations</span>
                        <span className="text-slate-900 font-medium tabular-nums">{rel.childrenCount}</span>
                      </div>
                    )}
                    {rel.childrenSample && rel.childrenSample.length > 0 && (
                      <div className="text-[11px] text-slate-500">e.g. {rel.childrenSample.join(", ")}, …</div>
                    )}
                    {rel.lanePair && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Lane pair</span>
                        <Link
                          to="/categories/$gcid"
                          params={{ gcid: rel.lanePair.gcid }}
                          className="text-violet-700 hover:underline font-medium"
                        >
                          {rel.lanePair.name} →
                        </Link>
                      </div>
                    )}
                    {rel.laneOwns && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Canonical count here</span>
                        <span className="text-slate-900 font-medium capitalize">{rel.laneOwns}</span>
                      </div>
                    )}
                    <p className="text-[11px] leading-relaxed text-slate-500 pt-2 border-t">
                      {rel.overlapNote}
                    </p>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Node Registry</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="text-3xl font-semibold text-slate-900">
                      {data.totalNodes}
                    </span>
                    <span className="text-xs text-slate-500">total nodes</span>
                  </div>
                  {ringEntries.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No nodes registered — build Layer 3.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {ringEntries.map(([ring, count]) => (
                        <div key={ring} className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">{ring}</span>
                          <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                            {count}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right column */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm">Knowledge Model</CardTitle>
                  <span className="text-xs text-slate-400">
                    read-only — details on Knowledge Model tab
                  </span>
                </CardHeader>
                <CardContent className="space-y-4">
                  {knowRows.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No knowledge model — build Layer 1 first.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                          Lanes
                        </span>
                        {knowRows.map((r) => (
                          <Badge
                            key={r.entity_type}
                            variant="secondary"
                            className={cn(
                              "capitalize",
                              r.entity_type === "professional"
                                ? "bg-emerald-100 text-emerald-800"
                                : r.entity_type === "location"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-violet-100 text-violet-800",
                            )}
                          >
                            {r.entity_type}
                          </Badge>
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-4 pt-2 border-t text-center">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Value props</div>
                          <div className="text-lg font-semibold text-slate-900">
                            {knowRows.reduce((s, r) => s + (Array.isArray(r.value_props) ? r.value_props.length : 0), 0)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Search intents</div>
                          <div className="text-lg font-semibold text-slate-900">
                            {knowRows.reduce((s, r) => s + (Array.isArray(r.search_intents) ? r.search_intents.length : 0), 0)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Conversion actions</div>
                          <div className="text-lg font-semibold text-slate-900">
                            {knowRows.reduce((s, r) => s + (Array.isArray(r.conversion_actions) ? r.conversion_actions.length : 0), 0)}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 pt-3 border-t">
                        <div>
                          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                            SDR tone
                          </div>
                          <div className="text-sm text-slate-800">
                            {sdrTone ?? <span className="text-slate-400">—</span>}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                            Compliance restrictions
                          </div>
                          <div className="text-sm text-slate-800">
                            {complianceRestrictions
                              ? String(complianceRestrictions).slice(0, 100) +
                                (String(complianceRestrictions).length > 100 ? "…" : "")
                              : <span className="text-slate-400">—</span>}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Category Validation — live rows from exp_validate_category_full(gcid) */}
              {validationRows.length > 0 && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-sm">Category Validation</CardTitle>
                    <Badge
                      variant="secondary"
                      className={cn(
                        validationPassed === validationRows.length
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800",
                      )}
                    >
                      {validationPassed} / {validationRows.length} passing
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {validationRows.map((v) => (
                        <div
                          key={v.check_code}
                          className={cn(
                            "flex items-start gap-2 text-xs rounded-md px-2.5 py-1.5 border",
                            v.passed
                              ? "border-emerald-200 bg-emerald-50/50"
                              : "border-amber-200 bg-amber-50/50",
                          )}
                        >
                          <span className={cn(
                            "font-mono shrink-0",
                            v.passed ? "text-emerald-700" : "text-amber-700",
                          )}>
                            {v.passed ? "✓" : "✗"}
                          </span>
                          <div className="min-w-0">
                            <div className="font-mono text-[11px] text-slate-700">{v.check_code}</div>
                            <div className="text-[11px] text-slate-500 truncate">{v.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Onboarding & Directories */}
              {(data.uiConfigs.length > 0 || data.directories.length > 0) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Onboarding &amp; Directories</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {data.uiConfigs.length > 0 && (
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">
                          Onboarding lanes
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {data.uiConfigs.map((u: any) => {
                            const steps = Array.isArray(u.onboarding_steps) ? u.onboarding_steps.length : 0;
                            const sections = Array.isArray(u.profile_sections) ? u.profile_sections.length : 0;
                            return (
                              <div
                                key={u.entity_type}
                                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs"
                              >
                                <span className="capitalize font-medium text-slate-900">
                                  {u.entity_type}
                                </span>
                                <span className="text-slate-500 ml-2">
                                  {steps} steps · {sections} sections
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {data.directories.length > 0 && (
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">
                          Target directories ({data.directories.length})
                        </div>
                        <div className="space-y-1">
                          {data.directories.slice(0, 10).map((d: any) => (
                            <div
                              key={d.directory_key}
                              className="flex items-center justify-between text-xs border-b border-slate-100 py-1"
                            >
                              <span className="text-slate-800">
                                {d.directory_name}
                                {d.is_required && (
                                  <Badge variant="secondary" className="ml-2 bg-emerald-100 text-emerald-800 text-[10px]">
                                    required
                                  </Badge>
                                )}
                              </span>
                              <span className="font-mono text-[10px] text-slate-400">{d.schema_type ?? "—"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {data.groups.length > 0 && (
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">
                          Category groups
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {data.groups.map((g: any, i: number) => (
                            <Pill key={i}>
                              {g.exp_category_groups?.name ?? g.group_id}
                              {g.is_primary && <span className="ml-1 text-emerald-700">•</span>}
                            </Pill>
                          ))}
                        </div>
                      </div>
                    )}
                    {data.secondaries.length > 0 && (
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">
                          Secondary adjacencies ({data.secondaries.length})
                        </div>
                        <div className="space-y-1">
                          {data.secondaries.slice(0, 8).map((s: any) => (
                            <div key={s.secondary_gcid} className="flex items-center justify-between text-xs">
                              <Link
                                to="/categories/$gcid"
                                params={{ gcid: s.secondary_gcid }}
                                className="text-slate-700 hover:text-slate-900 hover:underline font-mono"
                              >
                                {s.secondary_gcid}
                              </Link>
                              <span className="text-slate-400">relevance {s.relevance ?? "—"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}


              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Compliance</CardTitle>
                </CardHeader>
                <CardContent>
                  {!comp ? (
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-slate-500">
                        No compliance rules configured
                      </p>
                      <Button
                        size="sm" variant="outline"
                        onClick={() => setActiveTab("Compliance")}
                      >
                        <Plus className="h-3 w-3" /> Add Rules
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                            Display license
                          </div>
                          <YesNo value={comp.display_license_on_profile} />
                        </div>
                        <div>
                          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                            Age gate
                          </div>
                          <YesNo value={comp.age_gate_required} />
                        </div>
                        <div>
                          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                            HIPAA applies
                          </div>
                          <YesNo value={comp.hipaa_applies} />
                        </div>
                      </div>
                      <div className="pt-3 border-t">
                        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                          Regulated by
                        </div>
                        {regulatedBy.length === 0 ? (
                          <span className="text-sm text-slate-400">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {regulatedBy.map((r, i) => <Pill key={i}>{r}</Pill>)}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {(rel?.childrenGcids?.length ?? 0) > 0 && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-sm">Specializations</CardTitle>
                    <span className="text-xs text-slate-400">
                      {(childrenQ.data?.length ?? rel?.childrenCount ?? 0).toLocaleString()} subset categories
                    </span>
                  </CardHeader>
                  <CardContent>
                    <p className="text-[12px] leading-relaxed text-slate-500 mb-3">
                      Every category below is a subset of {cat.display_name}. Their profiles and
                      locations are already inside the{" "}
                      {cat.estimated_profiles != null ? Number(cat.estimated_profiles).toLocaleString() : "—"}{" "}
                      profiles shown above — so the net-unique total for this branch is{" "}
                      {cat.display_name}&apos;s own number, never the sum of the rows below.
                    </p>
                    {childrenQ.isLoading ? (
                      <p className="text-sm text-slate-400">Loading specializations…</p>
                    ) : (childrenQ.data ?? []).length === 0 ? (
                      <p className="text-sm text-slate-400">No specializations found.</p>
                    ) : (
                      <div className="max-h-96 overflow-auto rounded-md border border-slate-200 divide-y divide-slate-100">
                        {(childrenQ.data ?? []).map((c) => (
                          <Link
                            key={c.gcid}
                            to="/categories/$gcid"
                            params={{ gcid: c.gcid }}
                            className="flex items-center justify-between px-3 py-2 hover:bg-slate-50"
                          >
                            <span className="flex items-center gap-2 text-sm text-slate-700">
                              <span className="text-slate-300">↳</span>
                              {c.display_name}
                            </span>
                            <span className="text-xs tabular-nums text-slate-400">
                              {c.estimated_profiles != null ? Number(c.estimated_profiles).toLocaleString() : "—"}
                              {" / "}
                              {c.estimated_locations != null ? Number(c.estimated_locations).toLocaleString() : "—"}
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </EmpLayout>
  );
}
