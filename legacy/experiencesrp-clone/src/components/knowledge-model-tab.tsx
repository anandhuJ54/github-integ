import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CategoryIntelligencePanel } from "@/lib/category-intelligence";
import { cn } from "@/lib/utils";

export type KnowledgeRow = {
  id?: string;
  gcid: string;
  entity_type: string;
  value_props?: unknown;
  search_intents?: unknown;
  conversion_actions?: unknown;
  services?: unknown;
  compliance_rules?: string[] | null;
  customer_journey?: unknown;
  ranking_factors?: unknown;
  expertise_signals?: unknown;
  ai_agents?: Record<string, unknown> | null;
  // legacy — still present on some categories, surfaced with a "legacy" tag
  terminology?: string[] | null;
  content_topics?: string[] | null;
  review_vocabulary?: string[] | null;
  scoring_weights?: Record<string, number> | null;
};

const LEGACY_FIELDS = ["terminology", "content_topics", "review_vocabulary", "scoring_weights"] as const;

function LaneToneClass(lane: string) {
  return lane === "professional"
    ? "bg-emerald-100 text-emerald-800"
    : lane === "location"
      ? "bg-blue-100 text-blue-800"
      : "bg-violet-100 text-violet-800";
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function textOfProp(p: unknown): string | null {
  if (p == null) return null;
  if (typeof p === "string") return p;
  if (typeof p === "object") {
    const o = p as Record<string, unknown>;
    return (
      (typeof o.text === "string" && o.text) ||
      (typeof o.label === "string" && o.label) ||
      (typeof o.query === "string" && o.query) ||
      (typeof o.name === "string" && o.name) ||
      (typeof o.title === "string" && o.title) ||
      null
    );
  }
  return String(p);
}

function laneOf(p: unknown): string | null {
  if (p && typeof p === "object") {
    const l = (p as Record<string, unknown>).lane;
    if (typeof l === "string") return l;
  }
  return null;
}

/* ---------- Small display helpers ---------- */

function EmptyLine() {
  return <span className="text-sm text-slate-400">—</span>;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
      {children}
    </span>
  );
}

function ListCard({
  title,
  hint,
  items,
  render,
  empty = "None yet.",
}: {
  title: string;
  hint?: string;
  items: unknown[];
  render: (item: unknown, i: number) => React.ReactNode;
  empty?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-slate-400">{empty}</p>
        ) : (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i}>{render(it, i)}</div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConversionCard({ actions }: { actions: unknown[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Conversion Actions</CardTitle>
        <p className="text-xs text-slate-500">
          Emitted as <span className="font-mono">potentialAction</span> in the schema payload.
        </p>
      </CardHeader>
      <CardContent>
        {actions.length === 0 ? (
          <p className="text-sm text-slate-400">No conversion actions defined.</p>
        ) : (
          <div className="space-y-3">
            {actions.map((a, i) => {
              const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
              const label = (o.label as string) || (o.key as string) || `action_${i + 1}`;
              const schemaAction = o.schema_action as string | undefined;
              const goal = o.agent_goal as string | undefined;
              return (
                <div
                  key={i}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-slate-900 text-sm">{label}</div>
                    {schemaAction && (
                      <span className="font-mono text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5">
                        {schemaAction}
                      </span>
                    )}
                  </div>
                  {goal && (
                    <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{goal}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AiAgentsCard({ agents }: { agents: Record<string, unknown> | null | undefined }) {
  const a = (agents ?? {}) as Record<string, unknown>;
  const entries: [string, unknown][] = [
    ["SDR tone", a.sdr_tone ?? (a as any)?.sdr?.tone],
    ["Review-response style", a.review_response_style],
    ["Compliance restrictions", a.compliance_restrictions],
  ];
  const filtered = entries.filter(([, v]) => v != null && v !== "");
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">AI Agent Notes</CardTitle>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 && !a.top_content_topics ? (
          <p className="text-sm text-slate-400">No agent notes.</p>
        ) : (
          <div className="space-y-3 text-sm">
            {filtered.map(([label, v]) => (
              <div key={label}>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-0.5">
                  {label}
                </div>
                <div className="text-slate-800 leading-relaxed">{String(v)}</div>
              </div>
            ))}
            {Array.isArray(a.top_content_topics) && (a.top_content_topics as unknown[]).length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                  Top content topics
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(a.top_content_topics as unknown[]).map((t, i) => (
                    <Pill key={i}>{String(t)}</Pill>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- Tab ---------- */

export function KnowledgeModelTab({
  gcid,
  knowledge,
}: {
  gcid: string;
  knowledge: KnowledgeRow[] | null | undefined;
}) {
  const rows = knowledge ?? [];
  const lanes = useMemo(() => rows.map((r) => r.entity_type), [rows]);
  const [lane, setLane] = useState<string>(lanes[0] ?? "professional");
  const active = rows.find((r) => r.entity_type === lane) ?? rows[0] ?? null;

  const legacyRow = rows.find((r) => r.entity_type === "both");

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <CategoryIntelligencePanel gcid={gcid} knowledge={null} />
        <Card>
          <CardContent className="py-16 text-center text-slate-500 text-sm">
            No knowledge model yet for this category.
          </CardContent>
        </Card>
      </div>
    );
  }

  const valueProps = toArray(active?.value_props);
  const searchIntents = toArray(active?.search_intents);
  const conversionActions = toArray(active?.conversion_actions);
  const services = toArray(active?.services);
  const complianceRules = Array.isArray(active?.compliance_rules)
    ? (active!.compliance_rules as string[])
    : [];
  const customerJourney = toArray(active?.customer_journey);
  const rankingFactors = toArray(active?.ranking_factors);
  const expertiseSignals = toArray(active?.expertise_signals);

  const legacyPresent =
    !!legacyRow ||
    LEGACY_FIELDS.some((k) => {
      const v = active ? (active as any)[k] : null;
      if (Array.isArray(v)) return v.length > 0;
      if (v && typeof v === "object") return Object.keys(v).length > 0;
      return false;
    });

  return (
    <div className="space-y-6">
      <CategoryIntelligencePanel gcid={gcid} knowledge={active as any} />

      {/* Lane toggle */}
      <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3">
        <span className="text-sm text-slate-500">Lane</span>
        <div className="flex gap-1">
          {rows.map((r) => (
            <button
              key={r.entity_type}
              onClick={() => setLane(r.entity_type)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium border transition-colors capitalize",
                r.entity_type === lane
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 text-slate-600 hover:border-slate-400",
              )}
            >
              {r.entity_type}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {rows.length === 1 && lanes[0] === "both" && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 gap-1">
              <AlertTriangle className="h-3 w-3" /> Legacy shape — single `both` row
            </Badge>
          )}
          <Badge variant="secondary" className={LaneToneClass(lane)}>
            {rows.length} {rows.length === 1 ? "row" : "rows"} in <code className="font-mono ml-1">exp_category_knowledge</code>
          </Badge>
        </div>
      </div>

      {/* Two-column render */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <ListCard
            title="Value Props"
            hint="What this lane offers — surfaced on profile and in agent prompts."
            items={valueProps}
            render={(vp) => {
              const text = textOfProp(vp);
              const l = laneOf(vp);
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-slate-800 leading-relaxed">{text ?? JSON.stringify(vp)}</p>
                    {l && l !== lane && (
                      <Badge variant="secondary" className={cn("shrink-0 text-[10px]", LaneToneClass(l))}>{l}</Badge>
                    )}
                  </div>
                </div>
              );
            }}
          />

          <ListCard
            title="Search Intents"
            hint="Queries this lane must show up for."
            items={searchIntents}
            render={(q) => {
              const text = textOfProp(q);
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 font-mono">
                  {text ?? JSON.stringify(q)}
                </div>
              );
            }}
          />

          <ConversionCard actions={conversionActions} />

          <ListCard
            title="Services"
            items={services}
            render={(s) => {
              const text = textOfProp(s) ?? (typeof s === "string" ? s : JSON.stringify(s));
              return <Pill>{text}</Pill>;
            }}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Compliance Rules</CardTitle>
              <p className="text-xs text-slate-500">Enforced by <code className="font-mono">exp_category_compliance</code>.</p>
            </CardHeader>
            <CardContent>
              {complianceRules.length === 0 ? (
                <EmptyLine />
              ) : (
                <ul className="space-y-1.5 text-sm text-slate-700 list-disc pl-5">
                  {complianceRules.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>

          <ListCard
            title="Customer Journey"
            items={customerJourney}
            render={(j, i) => {
              const text = textOfProp(j) ?? JSON.stringify(j);
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 flex gap-2">
                  <span className="text-xs text-slate-400 w-5 shrink-0">{i + 1}.</span>
                  <span className="leading-relaxed">{text}</span>
                </div>
              );
            }}
          />

          <ListCard
            title="Ranking Factors"
            items={rankingFactors}
            render={(f) => {
              const text = textOfProp(f) ?? JSON.stringify(f);
              return <div className="text-sm text-slate-800 leading-relaxed">• {text}</div>;
            }}
          />

          <ListCard
            title="Expertise Signals"
            items={expertiseSignals}
            render={(s) => {
              const text = textOfProp(s) ?? JSON.stringify(s);
              return <Pill>{text}</Pill>;
            }}
          />

          <AiAgentsCard agents={active?.ai_agents} />
        </div>
      </div>

      {legacyPresent && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-900">
              <AlertTriangle className="h-4 w-4" /> Legacy fields present
            </CardTitle>
            <p className="text-xs text-amber-800">
              These columns are being retired — canon lives in <code className="font-mono">exp_taxonomy</code>. Shown for audit only.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {LEGACY_FIELDS.map((f) => {
              const v = (active as any)?.[f];
              const arr = Array.isArray(v) ? v : v && typeof v === "object" ? Object.entries(v) : [];
              if (arr.length === 0) return null;
              return (
                <div key={f}>
                  <div className="text-xs uppercase tracking-wide text-amber-900 mb-1">
                    {f.replace(/_/g, " ")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {arr.slice(0, 40).map((x, i) => (
                      <Pill key={i}>{typeof x === "string" ? x : JSON.stringify(x)}</Pill>
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
