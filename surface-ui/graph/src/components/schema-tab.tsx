import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, useServerFn } from "@v3/state/api/server-fn";
import { Card, CardContent } from "@v3/shared/components/ui/card";
import { Button } from "@v3/shared/components/ui/button";
import { cn } from "@v3/shared/components/utils/utils";
import { getCurrentUser } from "@v3/state/session/current-user";
import { generateCategorySchema } from "@v3/graph/utils/expertise-schema.functions";
import {
  getCategorySchema,
  countFields,
  countScored,
  type CategorySchema,
  type LaneDef,
  type ElementDef,
  type FieldDef,
  type ProfileSection,
} from "@v3/graph/utils/expertise-schema";

// Canonical 13-ring order — mirrors node-registry-tab so the Schema tab groups
// registry-derived fields into the same buckets users see there.
const RING_ORDER: { key: string; label: string; group: string }[] = [
  { key: "identity",     label: "Identity",     group: "root identity + contact" },
  { key: "presence",     label: "Presence",     group: "sameAs / ProfilePage" },
  { key: "location",     label: "Location",     group: "PostalAddress / GeoCoordinates / areaServed" },
  { key: "authority",    label: "Authority",    group: "EducationalOccupationalCredential / Occupation / PropertyValue" },
  { key: "services",     label: "Services",     group: "Service / OfferCatalog / Offer" },
  { key: "content",      label: "Content",      group: "CreativeWork (author @id -> professional)" },
  { key: "media",        label: "Media",        group: "ImageObject / VideoObject" },
  { key: "reputation",   label: "Reputation",   group: "AggregateRating / Review (per-source publisher @id)" },
  { key: "social",       label: "Social",       group: "sameAs / InteractionCounter" },
  { key: "engagement",   label: "Engagement",   group: "InteractionCounter + interactionType" },
  { key: "conversion",   label: "Conversion",   group: "potentialAction -> Action subtypes" },
  { key: "transactions", label: "Transactions", group: "CompletedActionStatus / Order" },
  { key: "entity_graph", label: "Entity graph", group: "worksFor / memberOf / parentOrganization" },
];
const SOURCE_LABEL: Record<string, string> = {
  manual: "Profile", platform: "Platform", etl: "ETL", oauth: "Social",
  crm_sync: "CRM", rss: "CMS", api: "API",
};

type RegNode = {
  node_name: string;
  ring: string | null;
  entity_scope: string | null;
  connection_method: string | null;
  schema_type: string | null;
  schema_property: string | null;
  required_for_score: boolean | null;
  priority: number | null;
};

function laneScopes(laneKey: string): Set<string> {
  if (laneKey === "professional") return new Set(["professional", "shared"]);
  if (laneKey === "location") return new Set(["location", "shared"]);
  return new Set(["professional", "location", "shared"]);
}

function buildElementsFromRegistry(nodes: RegNode[], laneKey: string): ElementDef[] {
  const scopes = laneScopes(laneKey);
  const filtered = nodes.filter((n) => scopes.has((n.entity_scope ?? "shared").toLowerCase()));
  const byRing = new Map<string, FieldDef[]>();
  for (const n of filtered) {
    const ring = (n.ring ?? "identity").toLowerCase();
    const prop = n.schema_property?.trim() || "— (platform only)";
    const type = n.schema_type?.trim() || (prop === "— (platform only)" ? "Platform" : "Text");
    const source = SOURCE_LABEL[n.connection_method ?? "manual"] ?? "Profile";
    const arr = byRing.get(ring) ?? [];
    arr.push({
      label: n.node_name,
      prop,
      type,
      source,
      scored: !!n.required_for_score,
    });
    byRing.set(ring, arr);
  }
  // Order fields within a ring by priority desc, then label
  for (const arr of byRing.values()) {
    arr.sort((a, b) => a.label.localeCompare(b.label));
  }
  const out: ElementDef[] = [];
  let n = 1;
  for (const r of RING_ORDER) {
    const fields = byRing.get(r.key);
    if (!fields || !fields.length) continue;
    out.push({ n: n++, name: r.label, group: r.group, fields });
  }
  // Preserve any legacy ring keys not in canonical 13
  for (const [ring, fields] of byRing.entries()) {
    if (RING_ORDER.some((r) => r.key === ring)) continue;
    out.push({ n: n++, name: ring, group: ring, fields });
  }
  return out;
}

type Section = "Fields" | "Profile" | "HTML" | "SEO";

export function SchemaTab({
  gcid,
  displayName,
  entityType,
}: {
  gcid: string;
  displayName: string;
  entityType?: string | null;
  totalNodes?: number;
  hasNodes?: boolean;
}) {
  const qc = useQueryClient();
  const generateFn = useServerFn(generateCategorySchema);

  const storedQ = useQuery({
    queryKey: ["category-schema", gcid],
    queryFn: async () => {
      try {
        const data = await api.get<{ schema_json: unknown; model: string | null } | null>("/graph/categories/schema", {
          params: { gcid },
        });
        if (!data?.schema_json) return null;
        return { schema: data.schema_json as CategorySchema, model: (data.model as string) ?? null };
      } catch {
        return null;
      }
    },
  });

  // Registry nodes power the per-lane fields view. entity_scope filtering here is
  // the fix for the "same fields on both lanes" bug — the stored projection JSON
  // was built before scope existed, so we re-derive lane.elements from registry.
  const registryQ = useQuery({
    queryKey: ["schema-tab-registry", gcid],
    queryFn: async () => {
      const data = await api
        .get<RegNode[]>("/graph/categories/schema/registry", { params: { gcid } })
        .catch(() => [] as RegNode[]); // the read's error was ignored
      return (data ?? []) as RegNode[];
    },
  });

  const staticSchema = getCategorySchema(gcid);
  const schema: CategorySchema | null = storedQ.data?.schema ?? staticSchema;
  const isStored = !!storedQ.data;
  // Registry-derived, linted projections are canonical: free-form AI regeneration must
  // not overwrite gated output (canon: one fact, one home; generators fix data, not clicks).
  const isLintedProjection = storedQ.data?.model === "registry-projection-linted-v1";

  const generate = useMutation({
    mutationFn: async () => {
      const user = await getCurrentUser();
      if (!user) {
        window.location.href = `/auth?redirect=${encodeURIComponent(window.location.pathname)}`;
        throw new Error("Sign in required to generate schema.");
      }
      return generateFn({ data: { gcid, displayName, entityType: entityType ?? "location" } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["category-schema", gcid] }),
  });

  const [laneKey, setLaneKey] = useState<string>("professional");
  const [section, setSection] = useState<Section>("Fields");
  const [markupView, setMarkupView] = useState<"jsonld" | "html">("jsonld");

  useEffect(() => {
    if (schema && !schema.lanes.some((l) => l.key === laneKey)) {
      setLaneKey(schema.lanes[schema.lanes.length - 1].key);
    }
  }, [schema, laneKey]);

  if (storedQ.isLoading && !staticSchema) {
    return <div className="p-6 text-sm text-slate-500">Loading schema…</div>;
  }

  if (!schema) {
    return (
      <div className="space-y-5">
        <Card className="border-slate-200">
          <CardContent className="p-6 space-y-4 text-sm text-slate-700">
            <div className="text-base font-semibold text-slate-900">
              Combined schema — not defined yet
            </div>
            <p className="leading-relaxed text-slate-500">
              The combined schema for <code className="text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">{gcid}</code>{" "}
              hasn&apos;t been built. The expertise-graph frame (9 elements, location +
              professional lanes) is the same for every category — only the fields,
              schema.org types, and profile sections differ. Generate this category to
              fill the contract.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
            >
              {generate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {generate.isPending ? "Generating…" : "Generate with AI"}
            </Button>
            {generate.isError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-[13px]">
                {(generate.error as Error)?.message ?? "Generation failed."}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const baseLane = schema.lanes.find((l) => l.key === laneKey) ?? schema.lanes[0];
  const registryNodes = registryQ.data ?? [];
  const derivedElements = registryNodes.length
    ? buildElementsFromRegistry(registryNodes, baseLane.key)
    : null;
  // Root type override: professional lane leads with Person (per canon); location
  // lane keeps its stored business-type root.
  const laneSchemaType = derivedElements && baseLane.key === "professional"
    ? (baseLane.schemaType.includes("Person") ? baseLane.schemaType : `Person + ${baseLane.schemaType.replace(/^Person\s*\+\s*/, "")}`)
    : baseLane.schemaType;
  const lane: LaneDef = derivedElements
    ? { ...baseLane, elements: derivedElements, schemaType: laneSchemaType }
    : baseLane;

  return (
    <div className="space-y-5">
      {/* Lane + section controls */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-500">Lane</span>
        <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden bg-white">
          {schema.lanes.map((l) => (
            <button
              key={l.key}
              onClick={() => setLaneKey(l.key)}
              className={cn(
                "px-4 py-1.5 text-[13px]",
                l.key === laneKey
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[13px] text-slate-500">
          schema.org · <span className="font-mono text-emerald-700">{lane.schemaType}</span>
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden bg-white">
          {(["Fields", "Profile", "HTML", "SEO"] as Section[]).map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={cn(
                "px-4 py-1.5 text-[13px]",
                s === section ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        {isStored && isLintedProjection && (
          <span
            className="ml-auto text-[11px] text-slate-400"
            title="This schema is a linted projection of the node registry. Changes flow registry -> projection pipeline, not free-form AI."
          >
            Registry projection · locked
          </span>
        )}
        {isStored && !isLintedProjection && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-2 text-slate-500"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            {generate.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {generate.isPending ? "Regenerating…" : "Regenerate"}
          </Button>
        )}
      </div>
      {generate.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-[13px]">
          {(generate.error as Error)?.message ?? "Generation failed."}
        </div>
      )}

      {section === "Fields" && <SchemaView lane={lane} />}
      {section === "SEO" && <SeoView lane={lane} />}
      {section === "Profile" && <ProfileView sections={lane.profile} />}
      {section === "HTML" && (
        <div className="space-y-3">
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden bg-white">
            {(["jsonld", "html"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setMarkupView(v)}
                className={cn(
                  "px-4 py-1.5 text-[13px]",
                  v === markupView ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50",
                )}
              >
                {v === "jsonld" ? "JSON-LD" : "Microdata HTML"}
              </button>
            ))}
          </div>
          <pre className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-[12px] leading-relaxed text-slate-700 font-mono whitespace-pre-wrap overflow-x-auto">
            {markupView === "jsonld" ? lane.jsonld : lane.html}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── SCHEMA FIELDS VIEW ──────────────────────────────────────────────────────

function SchemaView({ lane }: { lane: LaneDef }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-slate-500">
        <span><b className="text-slate-900">{countFields(lane)}</b> fields</span>
        <span><b className="text-slate-900">9</b> expertise elements</span>
        <span><b className="text-slate-900">{countScored(lane)}</b> score-bearing</span>
        <span>root type <b className="text-slate-900">{lane.schemaType}</b></span>
      </div>

      {lane.elements.map((el) => (
        <div key={el.n}>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-5 h-5 rounded bg-emerald-50 text-emerald-700 text-[11px] font-bold flex items-center justify-center">
              {el.n}
            </span>
            <span className="text-[15px] font-semibold text-slate-900">{el.name}</span>
            <span className="ml-auto font-mono text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
              {el.group}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="text-left font-medium py-1.5 px-2.5 border-b border-slate-200 w-1/4">Field</th>
                  <th className="text-left font-medium py-1.5 px-2.5 border-b border-slate-200 w-[30%]">schema.org property</th>
                  <th className="text-left font-medium py-1.5 px-2.5 border-b border-slate-200">Type</th>
                  <th className="text-left font-medium py-1.5 px-2.5 border-b border-slate-200">Source</th>
                  <th className="text-center font-medium py-1.5 px-2.5 border-b border-slate-200">Score</th>
                </tr>
              </thead>
              <tbody>
                {el.fields.map((f, i) => (
                  <tr key={i}>
                    <td className="py-1.5 px-2.5 border-b border-slate-100 font-medium text-slate-800">{f.label}</td>
                    <td className="py-1.5 px-2.5 border-b border-slate-100 font-mono text-[12px] text-emerald-700">{f.prop}</td>
                    <td className="py-1.5 px-2.5 border-b border-slate-100 text-slate-500">{f.type}</td>
                    <td className="py-1.5 px-2.5 border-b border-slate-100 text-slate-500">{f.source}</td>
                    <td className="py-1.5 px-2.5 border-b border-slate-100 text-center">
                      {f.scored && (
                        <span
                          title="contributes to Search Rank Score"
                          className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" /> contributes to the 850-point Search Rank Score
      </div>
    </div>
  );
}

// ─── SEO VIEW ────────────────────────────────────────────────────────────────

function SeoView({ lane }: { lane: LaneDef }) {
  return (
    <div>
      <div className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
        Page-level SEO — every attribute the page emits
      </div>
      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
        {lane.seo.map(([k, v], i) => (
          <div key={i} className="flex gap-3 px-4 py-2 text-[13px]">
            <span className="w-52 flex-none text-slate-500">{k}</span>
            <span className="font-mono text-[12px] text-slate-700 break-words">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PROFILE VIEW (v3 design, config-driven) ─────────────────────────────────

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md bg-slate-100 text-slate-600">
      {children}
    </span>
  );
}

function Avatar({ initials, square }: { initials: string; square?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-emerald-50 text-emerald-700 font-semibold flex-none",
        square ? "rounded-xl" : "rounded-full",
      )}
      style={{ width: 72, height: 72, fontSize: initials.length > 2 ? 18 : 22 }}
    >
      {initials}
    </div>
  );
}

function ScoreGauge({ value, max }: { value: number; max: number }) {
  const frac = Math.max(0, Math.min(1, value / max));
  const len = 251.3;
  return (
    <svg width="180" height="100" viewBox="0 0 200 110" role="img" aria-label={`Score ${value} of ${max}`}>
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#e2e8f0" strokeWidth="12" strokeLinecap="round" />
      <path
        d="M20 100 A80 80 0 0 1 180 100"
        fill="none"
        stroke="#059669"
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={len}
        strokeDashoffset={len * (1 - frac)}
      />
      <text x="100" y="84" textAnchor="middle" fontSize="30" fontWeight="600" fill="#0f172a">{value}</text>
      <text x="100" y="102" textAnchor="middle" fontSize="12" fill="#64748b">/ {max}</text>
    </svg>
  );
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      {title && <div className="text-[12px] font-semibold text-slate-500 mb-3">{title}</div>}
      {children}
    </div>
  );
}

function renderSection(s: ProfileSection, i: number) {
  switch (s.kind) {
    case "header":
      return (
        <div key={i} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4">
            <div className="flex gap-4">
              <Avatar initials={s.initials} square={s.square} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg font-semibold text-slate-900">{s.name}</span>
                  {s.badges?.map((b) => (
                    <span key={b} className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{b}</span>
                  ))}
                </div>
                <div className="text-[13px] text-slate-500 mt-0.5">{s.subtitle}</div>
                {s.rating && (
                  <div className="text-[13px] mt-1.5 flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-amber-600">{s.rating}</span>
                    <span className="text-amber-500">★★★★★</span>
                    <span className="text-slate-500">({s.ratingCount})</span>
                    {s.chips?.map((c) => <Chip key={c}>{c}</Chip>)}
                  </div>
                )}
                {s.lines?.map((l, k) => (
                  <div key={k} className="text-[13px] text-slate-500 mt-1">{l}</div>
                ))}
              </div>
            </div>
            {s.bio && <div className="text-[13px] text-slate-500 leading-relaxed mt-3">{s.bio}</div>}
            {s.chips && !s.rating && (
              <div className="flex gap-2 mt-2 flex-wrap">{s.chips.map((c) => <Chip key={c}>{c}</Chip>)}</div>
            )}
            {s.ctas && (
              <div className="flex gap-2 mt-3 flex-wrap">
                {s.ctas.map((c, k) => (
                  <span
                    key={c}
                    className={cn(
                      "text-[13px] px-3.5 py-1.5 rounded-lg",
                      k === 0 ? "bg-emerald-600 text-white" : "border border-slate-300 text-slate-700",
                    )}
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    case "infoCards":
      return (
        <div key={i} className="grid gap-3.5 sm:grid-cols-2">
          {s.cards.map((c, k) => (
            <SectionCard key={k} title={c.title}>
              {c.lines?.map((l, m) => <div key={m} className="text-[13px] text-slate-600 leading-7">{l}</div>)}
              {c.chips && <div className="flex gap-1.5 flex-wrap mt-2">{c.chips.map((x) => <Chip key={x}>{x}</Chip>)}</div>}
            </SectionCard>
          ))}
        </div>
      );
    case "lines":
      return (
        <SectionCard key={i} title={s.title}>
          {s.lines.map((l, k) => <div key={k} className="text-[13px] text-slate-600 leading-7">{l}</div>)}
        </SectionCard>
      );
    case "stats":
      return (
        <SectionCard key={i} title={s.title}>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            {s.stats.map((st, k) => (
              <div key={k} className="bg-slate-50 rounded-lg p-3">
                <div className="text-lg font-semibold text-slate-900">{st.value}</div>
                <div className="text-[12px] text-slate-500 mt-0.5">{st.label}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      );
    case "properties":
      return (
        <SectionCard key={i} title={s.title}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {s.items.map((p, k) => (
              <div key={k} className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="h-16 bg-slate-100 flex items-center justify-center text-slate-300 text-xl">⌂</div>
                <div className="p-2.5">
                  <div className="text-[13px] font-semibold text-slate-900">{p.price}</div>
                  <div className="text-[12px] text-slate-500">{p.meta}</div>
                  <span className="inline-block mt-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{p.status}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      );
    case "services":
      return (
        <SectionCard key={i} title={s.title}>
          {s.items.map((it, k) => (
            <div key={k} className="flex items-center gap-2 text-[13px] text-slate-700 py-1">
              <span className="text-emerald-600">✓</span> {it}
            </div>
          ))}
        </SectionCard>
      );
    case "chips":
      return (
        <SectionCard key={i} title={s.title}>
          <div className="flex gap-1.5 flex-wrap">{s.chips.map((c) => <Chip key={c}>{c}</Chip>)}</div>
        </SectionCard>
      );
    case "score":
      return (
        <SectionCard key={i} title={s.title}>
          <div className="flex items-center gap-5 flex-wrap">
            <ScoreGauge value={s.value} max={s.max} />
            <div className="flex-1 min-w-[180px] text-[13px] text-slate-500 leading-relaxed">
              Measures online search visibility across hundreds of attributes — identity,
              credentials, content, reviews, and outcomes.
            </div>
          </div>
        </SectionCard>
      );
    case "roster":
      return (
        <SectionCard key={i} title={s.title}>
          {s.members.map((m, k) => (
            <div key={k} className="flex items-center gap-2.5 py-2 border-t border-slate-100 first:border-t-0 text-[13px]">
              <span className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold flex items-center justify-center">{m.initials}</span>
              {m.name}
              <span className="ml-auto text-slate-500">{m.meta}</span>
            </div>
          ))}
          {s.note && <div className="text-[12px] text-slate-400 mt-2">{s.note}</div>}
        </SectionCard>
      );
    case "reviews":
      return (
        <SectionCard key={i} title={s.title}>
          <div className="text-[13px] text-slate-500 leading-7">{s.sources.join(" · ")}</div>
          {s.reviews.map((r, k) => (
            <div key={k} className="border-t border-slate-100 pt-3 mt-3 text-[13px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-800">{r.author}</span>
                <span className="text-slate-400 text-[12px]">{r.loc}</span>
              </div>
              <div className="text-amber-600 text-[12px] mt-0.5">{r.rating} · {r.date}</div>
              <div className="text-slate-600 mt-1 leading-relaxed">{r.body}</div>
              {r.reply && (
                <div className="bg-slate-50 border-l-2 border-slate-300 rounded-r-lg px-3 py-2 mt-2 text-[13px] text-slate-500">
                  ↳ {r.reply}
                </div>
              )}
            </div>
          ))}
        </SectionCard>
      );
    case "posts":
      return (
        <SectionCard key={i} title={s.title}>
          {s.posts.map((p, k) => (
            <div key={k} className="border border-slate-200 rounded-lg p-3 mb-2.5 last:mb-0">
              <div className="text-[12px] text-slate-500">{p.platform} · {p.ago}</div>
              <div className="text-[13px] text-slate-600 mt-1.5 leading-relaxed">{p.text}</div>
            </div>
          ))}
        </SectionCard>
      );
    case "disclaimer":
      return (
        <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="text-[12px] font-semibold text-slate-500 mb-1.5">Disclaimer</div>
          <div className="text-[12px] text-slate-400 leading-relaxed">{s.text}</div>
        </div>
      );
    default: {
      // Resilience: a generated definition may carry a profile kind we don't
      // explicitly handle. Render its content generically rather than dropping it.
      const u = s as Record<string, any>;
      const title: string | undefined = u.title ?? u.name;
      const lines: string[] | undefined = Array.isArray(u.lines) ? u.lines : undefined;
      const chips: string[] | undefined = Array.isArray(u.chips) ? u.chips : undefined;
      const items: unknown[] | undefined = Array.isArray(u.items) ? u.items : undefined;
      if (!title && !lines && !chips && !items) return null;
      return (
        <SectionCard key={i} title={title}>
          {lines?.map((l, k) => (
            <div key={k} className="text-[13px] text-slate-600 leading-7">{String(l)}</div>
          ))}
          {items?.map((it, k) => (
            <div key={k} className="text-[13px] text-slate-700 py-1">
              {typeof it === "string" ? it : JSON.stringify(it)}
            </div>
          ))}
          {chips && (
            <div className="flex gap-1.5 flex-wrap">{chips.map((c) => <Chip key={c}>{c}</Chip>)}</div>
          )}
        </SectionCard>
      );
    }
  }
}

function ProfileView({ sections }: { sections: ProfileSection[] }) {
  return <div className="space-y-3.5 max-w-[720px]">{sections.map((s, i) => renderSection(s, i))}</div>;
}
