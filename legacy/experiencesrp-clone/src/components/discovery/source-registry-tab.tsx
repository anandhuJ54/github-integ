import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Info, Network, Pause, Play, RefreshCw, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ReadOnlyLock } from "@/components/model-lock";
import { useRole } from "@/lib/roles";
import { CrawlMethodChip } from "@/components/discovery/crawl-method";
import { SourceActionsMenu, SourceStatusLine, useDiscoverMore, useSourceStates, MAPPABLE_METHODS } from "@/components/discovery/source-actions";
import { cn } from "@/lib/utils";

type SourceRow = {
  source_id: string;
  gcid: string;
  source_domain: string;
  source_type: string;
  authority_rank: number | null;
  freshness: string | null;
  hierarchy_sourceable: boolean | null;
  entity_types_available: string[] | null;
  field_coverage: unknown;
  field_count: number | null;
  daily_quota: number | null;
  min_delay_seconds: number | null;
  pull_window: string | null;
  access_method: string | null;
  robots_tos_status: string | null;
  status: string | null;
  notes: string | null;
  crawl_method: string | null;
};


const ROBOTS_STYLES: Record<string, string> = {
  unreviewed: "bg-amber-50 text-amber-700",
  allowed: "bg-emerald-50 text-emerald-700",
  restricted: "bg-red-50 text-red-700",
  prohibited: "bg-red-50 text-red-700",
};

const STATUS_STYLES: Record<string, string> = {
  proposed: "bg-slate-100 text-slate-600",
  approved: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  retired: "bg-slate-100 text-slate-500",
};

function AuthorityChip({ rank }: { rank: number | null }) {
  if (rank == null) return <span className="text-slate-400">—</span>;
  if (rank === 1)
    return (
      <Badge variant="secondary" className="bg-amber-100 font-semibold text-amber-800">
        PRIMARY
      </Badge>
    );
  if (rank === 2)
    return (
      <Badge variant="secondary" className="bg-slate-200 font-normal text-slate-700">
        2 · secondary
      </Badge>
    );
  return (
    <Badge variant="secondary" className="bg-slate-100 font-normal text-slate-500">
      {rank}
    </Badge>
  );
}

function coverageFields(coverage: unknown): string[] {
  if (!coverage || typeof coverage !== "object") return [];
  const fields = (coverage as Record<string, unknown>)["fields"];
  if (Array.isArray(fields)) return fields.map((f) => String(f));
  return [];
}

function fieldsDisplay(floor: number | null | undefined, fieldCount: number | null): string {
  if (floor != null && floor > 0) return String(floor);
  if (fieldCount != null && fieldCount > 0) return String(fieldCount);
  return "—";
}

export function SourceRegistryTab() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [gcid, setGcid] = useState("all");
  const [q, setQ] = useState("");
  const [limitsFor, setLimitsFor] = useState<SourceRow | null>(null);
  // source_id -> latest remap request_id we queued, so the row can show a
  // "remap: pending/completed" indicator while the crawler picks it up.
  const [remapRequests, setRemapRequests] = useState<Record<string, number>>({});
  const { canEdit, logAudit } = useRole();
  const queryClient = useQueryClient();

  const { data: sources = [], isLoading } = useQuery({
    queryKey: ["exp_etl_sources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exp_etl_sources")
        .select(
          "source_id, gcid, source_domain, source_type, authority_rank, freshness, hierarchy_sourceable, entity_types_available, field_coverage, field_count, daily_quota, min_delay_seconds, pull_window, access_method, robots_tos_status, status, notes, crawl_method",
        )
        .order("gcid", { ascending: true })
        .order("authority_rank", { ascending: true, nullsFirst: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as SourceRow[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ source, status }: { source: SourceRow; status: "active" | "paused" }) => {
      const { error } = await supabase.rpc("exp_etl_set_source_status", {
        p_source: source.source_id,
        p_status: status,
        p_note: `Set to ${status} from Discovery console`,
      });
      if (error) throw error;
      return { source, status };
    },
    onSuccess: async ({ source, status }) => {
      toast.success(`${source.source_domain} → ${status}`);
      await logAudit("etl_source_status", source.source_id, { status, domain: source.source_domain });
      queryClient.invalidateQueries({ queryKey: ["exp_etl_sources"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setLimits = useMutation({
    mutationFn: async (vals: {
      source: SourceRow;
      quota: number | null;
      delay: number | null;
      window: string | null;
    }) => {
      const { error } = await supabase.rpc("exp_etl_set_limits", {
        p_source: vals.source.source_id,
        ...(vals.quota != null ? { p_daily_quota: vals.quota } : {}),
        ...(vals.delay != null ? { p_min_delay: vals.delay } : {}),
        ...(vals.window ? { p_window: vals.window } : {}),
      });
      if (error) throw error;
      return vals;
    },
    onSuccess: async (vals) => {
      toast.success(`Limits updated for ${vals.source.source_domain}`);
      await logAudit("etl_source_limits", vals.source.source_id, {
        daily_quota: vals.quota,
        min_delay_seconds: vals.delay,
        pull_window: vals.window,
      });
      setLimitsFor(null);
      queryClient.invalidateQueries({ queryKey: ["exp_etl_sources"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Re-trigger Station 3 (map_site) for one approved server_crawl source.
  // Mirrors disco_request_remap_site's own guardrails in the UI so we never
  // render a button that would just raise the function's exception.
  const remap = useMutation({
    mutationFn: async (source: SourceRow) => {
      const { data, error } = await supabase.rpc("disco_request_remap_site", {
        p_source_id: source.source_id,
      });
      if (error) throw error;
      return { source, requestId: Number(data) };
    },
    onSuccess: async ({ source, requestId }) => {
      toast.success(
        `Remap requested — request #${requestId} queued. It's picked up by the crawler within about 2 minutes.`,
      );
      await logAudit("etl_source_remap", source.source_id, {
        request_id: requestId,
        domain: source.source_domain,
      });
      setRemapRequests((m) => ({ ...m, [source.source_id]: requestId }));
      queryClient.invalidateQueries({ queryKey: ["disco_llm_requests_status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Track the status of every remap request we've queued this session so rows
  // can show "remap: pending" → "remap: completed". Polls while any pending.
  const remapIds = useMemo(() => Object.values(remapRequests), [remapRequests]);
  const remapStatuses = useQuery({
    enabled: remapIds.length > 0,
    queryKey: ["disco_llm_requests_status", remapIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("disco_llm_requests")
        .select("request_id, status")
        .in("request_id", remapIds);
      if (error) throw error;
      const map: Record<number, string> = {};
      for (const r of data ?? []) map[Number(r.request_id)] = String(r.status);
      return map;
    },
    refetchInterval: (query) => {
      const statuses = query.state.data as Record<number, string> | undefined;
      const anyPending = remapIds.some((id) => !statuses || statuses[id] === "pending");
      return anyPending ? 15000 : false;
    },
  });

  // G2 (2026-10-13): active / test_pull sources can be remapped too; the result is a proposal for review.
  // Fix (remap rendered / proxy sites, 2026-10-15): sites that need rendering or a proxy can be mapped too.
  const canRemap = (s: SourceRow) => ["approved", "active", "test_pull"].includes(s.status ?? "") &&
    MAPPABLE_METHODS.includes(s.crawl_method ?? "");

  const gcids = useMemo(() => Array.from(new Set(sources.map((s) => s.gcid))).sort(), [sources]);

  const { data: names = {} } = useQuery({
    enabled: gcids.length > 0,
    queryKey: ["gbp_categories_names", gcids],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gbp_categories")
        .select("gcid, display_name")
        .in("gcid", gcids);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const r of data ?? []) map[r.gcid as string] = r.display_name as string;
      return map;
    },
  });

  // Measured field floor from the latest site contract per (domain, gcid),
  // joined client-side. field_count is a generated column and is always 0
  // for site-contract sources, so the contract's field_floor is shown instead.
  const { data: fieldFloors = {} } = useQuery({
    queryKey: ["disco_site_contract_field_floors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("disco_site_contract")
        .select("domain, category_slug, field_floor, learned_at")
        .order("learned_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      const map: Record<string, number | null> = {};
      for (const r of data ?? []) {
        const key = `${r.domain}|${r.category_slug}`;
        if (!(key in map)) map[key] = r.field_floor == null ? null : Number(r.field_floor);
      }
      return map;
    },
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sources.filter((s) => {
      if (gcid !== "all" && s.gcid !== gcid) return false;
      if (!needle) return true;
      return (
        s.source_domain.toLowerCase().includes(needle) ||
        (s.source_type ?? "").toLowerCase().includes(needle) ||
        (names[s.gcid] ?? "").toLowerCase().includes(needle)
      );
    });
  }, [sources, gcid, q, names]);

  const activeCount = sources.filter((s) => s.status === "active").length;
  // Source actions (2026-10-15): live state per visible row (contract, open run, map / method check, proposal).
  const states = useSourceStates(rows);
  const discoverMore = useDiscoverMore();

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Total sources" value={sources.length} />
          <Stat label="Active" value={activeCount} />
          <Stat label="Categories covered" value={gcids.length} />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <span>
            Source definitions are governed rulings. Operators may only change run state and rate
            limits.
          </span>
          {canEdit ? null : <ReadOnlyLock />}
        </div>


        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Label className="text-xs text-slate-500">Search</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Domain, type, category…"
              className="mt-1"
            />
          </div>
          <div className="w-72">
            <Label className="text-xs text-slate-500">Category</Label>
            <Select value={gcid} onValueChange={setGcid}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {gcids.map((g) => (
                  <SelectItem key={g} value={g}>
                    {names[g] ?? g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canEdit && gcid !== "all" ? (
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1"
              disabled={discoverMore.isPending}
              onClick={() => discoverMore.mutate(gcid)}
            >
              <Network className="h-3.5 w-3.5" /> Discover more companies
            </Button>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5">Source</th>
                <th className="px-3 py-2.5">Category</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Crawl method</th>
                <th className="px-3 py-2.5">Authority</th>
                <th className="px-3 py-2.5">Freshness</th>
                <th className="px-3 py-2.5">Hier.</th>
                <th className="px-3 py-2.5">Entity types</th>
                <th className="px-3 py-2.5 text-right">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-help items-center gap-1">
                        Fields
                        <Info className="h-3 w-3 text-slate-400" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">
                      Measured field floor (distinct fields on the richest sample page)
                    </TooltipContent>
                  </Tooltip>
                </th>
                <th className="px-3 py-2.5 text-right">Quota</th>
                <th className="px-3 py-2.5">Window</th>
                <th className="px-3 py-2.5">Robots/ToS</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Notes</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={16} className="px-4 py-8 text-center text-sm text-slate-500">
                    Loading sources…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={16} className="px-4 py-8 text-center text-sm text-slate-500">
                    No sources registered yet.
                  </td>
                </tr>
              ) : (
                rows.map((s) => {
                  const open = expanded === s.source_id;
                  const fields = coverageFields(s.field_coverage);
                  return (
                    <Fragment key={s.source_id}>
                      <tr
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                        onClick={() => setExpanded(open ? null : s.source_id)}
                      >
                        <td className="px-3 py-2.5 text-slate-400">
                          {open ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-ink">{s.source_domain}</td>
                        <td className="px-3 py-2.5 text-slate-600">{names[s.gcid] ?? s.gcid}</td>
                        <td className="px-3 py-2.5">
                          <Badge variant="secondary" className="bg-slate-100 font-normal text-slate-600">
                            {s.source_type}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <CrawlMethodChip method={s.crawl_method} />
                        </td>
                        <td className="px-3 py-2.5">
                          <AuthorityChip rank={s.authority_rank} />
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{s.freshness ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          {s.hierarchy_sourceable ? (
                            <Network className="h-4 w-4 text-[color:var(--color-g-blue)]" aria-label="Hierarchy sourceable" />
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {(s.entity_types_available ?? []).map((t) => (
                              <span
                                key={t}
                                className="rounded-full bg-[color:var(--color-g-blue-soft)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--color-g-blue)]"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                          {fieldsDisplay(fieldFloors[`${s.source_domain}|${s.gcid}`], s.field_count)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                          {s.daily_quota ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{s.pull_window ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "font-normal capitalize",
                              ROBOTS_STYLES[s.robots_tos_status ?? ""] ?? "bg-slate-100 text-slate-600",
                            )}
                          >
                            {s.robots_tos_status ?? "—"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="space-y-1">
                            <Badge
                              variant="secondary"
                              className={cn(
                                "font-normal capitalize",
                                STATUS_STYLES[s.status ?? ""] ?? "bg-slate-100 text-slate-600",
                              )}
                            >
                              {s.status ?? "—"}
                            </Badge>
                            <SourceStatusLine state={states[s.source_id]} />
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {s.notes ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex">
                                  <Info className="h-4 w-4 text-slate-400" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">{s.notes}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          {canEdit ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <SourceActionsMenu source={s} state={states[s.source_id]} onLimits={() => setLimitsFor(s)} />
                            </div>
                          ) : (
                            <div className="flex justify-end">
                              <ReadOnlyLock />
                            </div>
                          )}
                        </td>
                      </tr>

                      {open ? (
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td colSpan={16} className="px-6 py-4">
                            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                              Field coverage {fields.length > 0 ? `(${fields.length})` : ""}
                            </div>
                            {fields.length === 0 ? (
                              <p className="mt-2 text-xs text-slate-500">No field coverage recorded.</p>
                            ) : (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {fields.map((f) => (
                                  <span
                                    key={f}
                                    className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600"
                                  >
                                    {f}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                              <div>
                                <span className="text-slate-400">Access method: </span>
                                {s.access_method ?? "—"}
                              </div>
                              <div>
                                <span className="text-slate-400">gcid: </span>
                                <span className="font-mono">{s.gcid}</span>
                              </div>
                            </div>
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

        <LimitsDialog
          source={limitsFor}
          pending={setLimits.isPending}
          onClose={() => setLimitsFor(null)}
          onSave={(vals) => limitsFor && setLimits.mutate({ source: limitsFor, ...vals })}
        />
      </div>
    </TooltipProvider>
  );
}

function LimitsDialog({
  source,
  pending,
  onClose,
  onSave,
}: {
  source: SourceRow | null;
  pending: boolean;
  onClose: () => void;
  onSave: (vals: { quota: number | null; delay: number | null; window: string | null }) => void;
}) {
  const [quota, setQuota] = useState("");
  const [delay, setDelay] = useState("");
  const [window, setWindow] = useState("");
  const [key, setKey] = useState<string | null>(null);

  if (source && key !== source.source_id) {
    setKey(source.source_id);
    setQuota(source.daily_quota != null ? String(source.daily_quota) : "");
    setDelay(source.min_delay_seconds != null ? String(source.min_delay_seconds) : "");
    setWindow(source.pull_window ?? "");
  }

  return (
    <Dialog open={source != null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Harvest limits</DialogTitle>
          <DialogDescription>
            {source ? source.source_domain : ""} — rate limits applied by the harvester.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-slate-500">Daily quota</Label>
            <Input
              type="number"
              min={0}
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-500">Min delay (seconds)</Label>
            <Input
              type="number"
              min={0}
              value={delay}
              onChange={(e) => setDelay(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-500">Pull window</Label>
            <Input
              value={window}
              onChange={(e) => setWindow(e.target.value)}
              placeholder="e.g. 02:00-06:00 UTC"
              className="mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSave({
                quota: quota.trim() === "" ? null : Number(quota),
                delay: delay.trim() === "" ? null : Number(delay),
                window: window.trim() === "" ? null : window.trim(),
              })
            }
          >
            Save limits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-ink">{value.toLocaleString()}</div>
    </div>
  );
}
