import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Network } from "lucide-react";
import { api } from "@v3/ui/lib/server-fn";
import { Badge } from "@v3/ui/components/ui/badge";
import { Input } from "@v3/ui/components/ui/input";
import { Label } from "@v3/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import { cn } from "@v3/ui/lib/utils";

type EntityRow = {
  entity_id: string;
  display_name: string;
  entity_type: string;
  status: string;
  claim_state: string;
  confidence: number;
  created_at: string;
  is_demo: boolean | null;
};

type RelRow = {
  rel_id: string;
  relationship_type: string;
  object_entity_id: string | null;
  object_gcid: string | null;
  status: string;
  is_primary: boolean;
  valid_from: string;
  valid_to: string | null;
  confidence: number;
};

const TYPE_STYLES: Record<string, string> = {
  professional: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  location: "bg-emerald-50 text-emerald-700",
  brand: "bg-violet-50 text-violet-700",
  team: "bg-amber-50 text-amber-700",
};

function EntityTypeBadge({ type }: { type: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn("font-normal capitalize", TYPE_STYLES[type] ?? "bg-slate-100 text-slate-600")}
    >
      {type}
    </Badge>
  );
}

function fmtDate(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString();
}

function RelationshipRows({ entityId, nameFor }: { entityId: string; nameFor: (id: string | null) => string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["exp_rel", entityId],
    queryFn: () =>
      api.get<RelRow[]>(`/graph/control/entities/${encodeURIComponent(entityId)}/relationships`),
  });

  if (isLoading) return <div className="px-6 py-3 text-xs text-slate-500">Loading relationships…</div>;
  const rows = data ?? [];
  if (rows.length === 0)
    return <div className="px-6 py-3 text-xs text-slate-500">No relationships recorded yet.</div>;

  return (
    <div className="px-6 py-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
            <th className="py-1 pr-3 font-medium">Relationship</th>
            <th className="py-1 pr-3 font-medium">Object</th>
            <th className="py-1 pr-3 font-medium">Status</th>
            <th className="py-1 pr-3 font-medium">Primary</th>
            <th className="py-1 pr-3 font-medium">Valid</th>
            <th className="py-1 font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rel_id} className="border-t border-slate-100">
              <td className="py-1.5 pr-3 font-mono text-[11px] text-slate-700">{r.relationship_type}</td>
              <td className="py-1.5 pr-3 text-slate-700">
                {r.object_entity_id ? nameFor(r.object_entity_id) : (r.object_gcid ?? "—")}
              </td>
              <td className="py-1.5 pr-3 text-slate-600">{r.status}</td>
              <td className="py-1.5 pr-3 text-slate-600">{r.is_primary ? "Yes" : "No"}</td>
              <td className="py-1.5 pr-3 text-slate-600">
                {fmtDate(r.valid_from)} → {r.valid_to ? fmtDate(r.valid_to) : "open"}
              </td>
              <td className="py-1.5 font-mono text-slate-600">{r.confidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EntitiesTab() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [demoOnly, setDemoOnly] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["exp_entity", "all"],
    queryFn: () => api.get<EntityRow[]>("/graph/control/entities"),
  });

  const rows = data ?? [];
  const nameFor = (id: string | null) =>
    rows.find((r) => r.entity_id === id)?.display_name ?? (id ? id.slice(0, 8) : "—");

  const types = useMemo(
    () => Array.from(new Set(rows.map((r) => r.entity_type))).sort(),
    [rows],
  );
  const statuses = useMemo(
    () => Array.from(new Set(rows.map((r) => r.status))).sort(),
    [rows],
  );

  const filtered = rows.filter(
    (r) =>
      (typeFilter === "all" || r.entity_type === typeFilter) &&
      (statusFilter === "all" || r.status === statusFilter) &&
      (!demoOnly || r.is_demo === true) &&
      (!search.trim() || r.display_name.toLowerCase().includes(search.trim().toLowerCase())),
  );

  if (!isLoading && rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-14 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[color:var(--color-g-blue-soft)]">
          <Network className="h-5 w-5 text-[color:var(--color-g-blue)]" />
        </div>
        <div className="mt-4 text-sm font-semibold text-slate-900">No entities yet</div>
        <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
          The graph populates as discovery runs. Professionals, locations, brands and teams appear
          here with their relationships as they are resolved.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <Label className="text-xs">Search</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entity name…"
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Entity type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map((t) => (
                <SelectItem key={t} value={t} className="capitalize">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <button
          type="button"
          onClick={() => setDemoOnly((v) => !v)}
          className={cn(
            "h-9 rounded-full border px-3 text-xs font-medium transition-colors",
            demoOnly
              ? "border-violet-300 bg-violet-100 text-violet-700"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
          )}
          aria-pressed={demoOnly}
        >
          Demo
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/70">
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="w-8" />
              <th className="px-3 py-2 font-medium">Entity</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Claim state</th>
              <th className="px-3 py-2 font-medium">Confidence</th>
              <th className="px-3 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-xs text-slate-500">
                  Loading entities…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-xs text-slate-500">
                  No entities match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const isOpen = open[r.entity_id] ?? false;
                return (
                  <Fragment key={r.entity_id}>
                    <tr
                      key={r.entity_id}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                      onClick={() => setOpen((s) => ({ ...s, [r.entity_id]: !isOpen }))}
                    >
                      <td className="pl-3 text-slate-400">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        <span className="inline-flex items-center gap-2">
                          {r.display_name}
                          {r.is_demo ? (
                            <Badge
                              variant="secondary"
                              className="bg-violet-100 text-[10px] font-bold uppercase tracking-wider text-violet-700"
                            >
                              Demo
                            </Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <EntityTypeBadge type={r.entity_type} />
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{r.status}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{r.claim_state}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.confidence}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(r.created_at)}</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.entity_id}-rels`} className="border-t border-slate-100 bg-slate-50/40">
                        <td colSpan={7}>
                          <RelationshipRows entityId={r.entity_id} nameFor={nameFor} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
