// ============================================================================
// Source actions (2026-10-15) — one place for every per-source action of the Discovery console, used by the
// Source Registry (Actions menu per row) and the Category population tab, so both screens behave the same.
// Each action's availability follows the source's live state: a contract exists, a run is open, a map or a method
// check is in progress, a proposal waits for review. Disabled items say why.
// ============================================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSearch, MoreHorizontal, Pause, Play, RefreshCw, RotateCcw, SearchCheck, SlidersHorizontal } from "lucide-react";
import { api } from "@v3/state/api/server-fn";
import { Button } from "@v3/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@v3/shared/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@v3/shared/components/ui/alert-dialog";
import { SiteContractPanel } from "@v3/etl/components/discovery/site-contract-panel";
import { useRole } from "@v3/state/access/roles";

/** An allow-listed ETL function through the API (the role-checked function decides). */
const rpc = <T = unknown,>(name: string, args: Record<string, unknown>) =>
  api.post<T>(`/etl/console/rpc/${name}`, { args });

export type ActionSource = {
  source_id: string;
  gcid: string;
  source_domain: string;
  status: string | null;
  crawl_method: string | null;
};

/** Crawl methods the site mapper can map (plain fetch, browser rendering, proxy). */
export const MAPPABLE_METHODS = ["server_crawl", "js_needs_api", "blocked_needs_proxy", "no_profiles_on_site"];
const RUNNABLE_STATUSES = ["approved", "test_pull", "active"];

export type SourceState = {
  hasContract: boolean;
  recordSource: string | null;
  runId: string | null;
  runningSince: string | null;
  queued: number | null;
  mapping: { requestId: number; status: string; step: string | null } | null;
  methodCheck: { requestId: number; status: string } | null;
  /** Last method check failed (pipeline sweep, 2026-10-15): the reason; Retry method check starts a new one. */
  methodFailed: string | null;
  /** Approved / test pull / active source with an unknown method and no check yet: the pipeline sweep queues one. */
  methodWaiting: boolean;
  lastMapError: string | null;
  pendingProposal: boolean;
};

const EMPTY_STATE: SourceState = {
  hasContract: false, recordSource: null, runId: null, runningSince: null, queued: null,
  mapping: null, methodCheck: null, methodFailed: null, methodWaiting: false, lastMapError: null, pendingProposal: false,
};

function invalidateDiscovery(qc: QueryClient) {
  qc.invalidateQueries({
    predicate: (q) => typeof q.queryKey[0] === "string" && /^(etl_|exp_etl|disco_|source_states)/.test(q.queryKey[0] as string),
  });
}

/** Live state of each source: contract, open run, map / method-check requests, pending proposals. */
export function useSourceStates(sources: ActionSource[]): Record<string, SourceState> {
  const ids = useMemo(() => sources.map((s) => s.source_id).sort(), [sources]);
  const domains = useMemo(() => [...new Set(sources.map((s) => s.source_domain))], [sources]);
  const { data } = useQuery({
    enabled: ids.length > 0,
    queryKey: ["source_states", ids.join(",")],
    queryFn: async () => {
      // contracts, open runs, map / method-check requests, pending proposals and the queued pages
      // of every domain with an open run, in one request
      const st = await api.post<{
        contracts: any[];
        runs: any[];
        reqs: any[];
        props: any[];
        queuedByDomain: Record<string, number | null>;
      }>("/etl/console/source-states", {
        sources: sources.map((s) => ({ source_id: s.source_id, source_domain: s.source_domain })),
      });
      const contracts = { data: st.contracts };
      const runs = { data: st.runs };
      const reqs = { data: st.reqs };
      const props = { data: st.props };
      const out: Record<string, SourceState> = {};
      for (const s of sources) {
        const c = (contracts.data ?? []).find((x: any) => x.domain === s.source_domain && x.category_slug === s.gcid);
        const run = (runs.data ?? []).find((x: any) => x.source_id === s.source_id);
        const mine = (reqs.data ?? []).filter((x: any) => x.domain === s.source_domain && (!x.category || x.category === s.gcid));
        const lastMap = mine.find((x: any) => x.tool === "map_site");
        const lastCheck = mine.find((x: any) => x.tool === "classify_method");
        const busy = (x: any) => x && (x.status === "pending" || x.status === "sent");
        out[s.source_id] = {
          hasContract: !!c?.detail_pattern && Number(c?.version ?? 0) >= 3,
          recordSource: c?.record_source ?? null,
          runId: run?.run_id ?? null,
          runningSince: run?.started_at ?? null,
          queued: null,
          mapping: busy(lastMap) ? { requestId: lastMap.request_id, status: lastMap.status, step: lastMap.step ?? null } : null,
          methodCheck: busy(lastCheck) ? { requestId: lastCheck.request_id, status: lastCheck.status } : null,
          methodFailed: lastCheck?.status === "error" ? String(lastCheck.error ?? "failed").slice(0, 120) : null,
          methodWaiting: !lastCheck && (s.crawl_method ?? "unprobed") === "unprobed" && RUNNABLE_STATUSES.includes(s.status ?? ""),
          lastMapError: lastMap?.status === "error" ? String(lastMap.error ?? "").replace(/^MapSiteError:\s*/, "") : null,
          pendingProposal: (props.data ?? []).some((p: any) => p.domain === s.source_domain && p.category_slug === s.gcid),
        };
      }
      // Queue size only for sources with an open run.
      for (const s of sources) if (out[s.source_id].runId) out[s.source_id].queued = st.queuedByDomain[s.source_domain] ?? null;
      return out;
    },
    refetchInterval: (q) => {
      const d = q.state.data as Record<string, SourceState> | undefined;
      return d && Object.values(d).some((x) => x.mapping || x.methodCheck || x.methodWaiting || x.runId) ? 20000 : false;
    },
  });
  return data ?? {};
}

/** The per-source actions (same RPCs as before), with audit and refresh of every Discovery view. */
export function useSourceActions() {
  const qc = useQueryClient();
  const { logAudit } = useRole();
  const run = useMutation({
    mutationFn: async (s: ActionSource) => {
      // run + the new run's seeding detail, in one request
      const { seeded } = await api.post<{ runId: string | null; seeded: any }>("/etl/console/sources/run", {
        source_id: s.source_id,
      });
      return { s, seeded: seeded ?? null };
    },
    onSuccess: async ({ s, seeded }) => {
      const parts = seeded
        ? [seeded.seeded_sitemaps ? `${seeded.seeded_sitemaps} sitemap(s)` : null,
           seeded.seeded_list_units ? `${seeded.seeded_list_units} list route start(s)` : null].filter(Boolean)
        : [];
      toast.success(`Crawl queued for ${s.source_domain}${parts.length ? ` — seeded ${parts.join(" and ")}` : seeded?.seeded_fallback ? " — seeded from robots.txt / homepage (no list route on the contract)" : ""}`);
      await logAudit("etl_source_run", s.source_id, { domain: s.source_domain, gcid: s.gcid });
      invalidateDiscovery(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reharvest = useMutation({
    mutationFn: async (s: ActionSource) => {
      const data = await rpc<number | null>("exp_etl_reharvest_source", { p_source: s.source_id });
      return { s, n: Number(data ?? 0) };
    },
    onSuccess: async ({ s, n }) => {
      toast.success(`${n} pages re-queued — run started`);
      await logAudit("etl_source_reharvest", s.source_id, { domain: s.source_domain, gcid: s.gcid, pages: n });
      invalidateDiscovery(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remap = useMutation({
    mutationFn: async (s: ActionSource) => {
      const data = await rpc<number>("disco_request_remap_site", { p_source_id: s.source_id });
      return { s, requestId: Number(data) };
    },
    onSuccess: async ({ s, requestId }) => {
      toast.success(`Remap requested for ${s.source_domain} — request #${requestId}. Picked up within about 2 minutes.`);
      await logAudit("etl_source_remap", s.source_id, { request_id: requestId, domain: s.source_domain, gcid: s.gcid });
      invalidateDiscovery(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const retryMethod = useMutation({
    mutationFn: async (s: ActionSource) => {
      await rpc("disco_retry_method_classification", { p_source_id: s.source_id });
      return s;
    },
    onSuccess: async (s) => {
      toast.success(`Method check queued for ${s.source_domain}`);
      await logAudit("etl_source_retry_method", s.source_id, { domain: s.source_domain, gcid: s.gcid });
      invalidateDiscovery(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setStatus = useMutation({
    mutationFn: async ({ s, status }: { s: ActionSource; status: "active" | "paused" }) => {
      await rpc("exp_etl_set_source_status", {
        p_source: s.source_id, p_status: status, p_note: `Set to ${status} from Discovery console`,
      });
      return { s, status };
    },
    onSuccess: async ({ s, status }) => {
      toast.success(`${s.source_domain} → ${status}`);
      await logAudit("etl_source_status", s.source_id, { status, domain: s.source_domain });
      invalidateDiscovery(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return { run, reharvest, remap, retryMethod, setStatus };
}

/** Category-level: discover more companies (discovery skips domains already seen for the category). */
export function useDiscoverMore() {
  const qc = useQueryClient();
  const { logAudit } = useRole();
  return useMutation({
    mutationFn: async (gcid: string) => {
      const data = await rpc("disco_activate", { p_category: gcid });
      return { gcid, job: data };
    },
    onSuccess: async ({ gcid, job }) => {
      toast.success("Discovery queued — new companies appear for review in Category population, step 2.");
      await logAudit("etl_category_discover_more", gcid, { job_id: job });
      invalidateDiscovery(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}

/** One short line under the status: mapping step, method check, open run, proposal, last map failure. */
export function SourceStatusLine({ state }: { state: SourceState | undefined }) {
  if (!state) return null;
  const lines: string[] = [];
  if (state.mapping) lines.push(`Mapping${state.mapping.step ? ` · step ${state.mapping.step}` : ""} (#${state.mapping.requestId})`);
  if (state.methodCheck) lines.push(`Method check ${state.methodCheck.status === "pending" ? "queued" : "running"} (#${state.methodCheck.requestId})`);
  else if (state.methodFailed) lines.push(`Method check failed: ${state.methodFailed} — use Retry method check`);
  else if (state.methodWaiting) lines.push("Waiting for method check (queued automatically within 2 minutes)");
  if (state.runningSince) lines.push(`Running since ${fmtTime(state.runningSince)}${state.queued != null ? ` · ${state.queued.toLocaleString()} queued` : ""}`);
  if (state.pendingProposal) lines.push("Proposal waiting for review");
  if (!state.hasContract && !state.mapping && state.lastMapError) lines.push(`Last map failed: ${state.lastMapError.slice(0, 80)}`);
  if (!lines.length) return null;
  return (
    <div className="space-y-0.5">
      {lines.map((l) => <div key={l} className="text-[10px] font-medium text-slate-500">{l}</div>)}
    </div>
  );
}

type Item = { key: string; label: string; icon: React.ReactNode; reason: string | null; onSelect: () => void };

/** Actions menu for one source. */
export function SourceActionsMenu({ source, state, onLimits }: { source: ActionSource; state: SourceState | undefined; onLimits?: () => void }) {
  const st = state ?? EMPTY_STATE;
  const { run, reharvest, remap, retryMethod, setStatus } = useSourceActions();
  const [contractOpen, setContractOpen] = useState(false);
  const [reharvestN, setReharvestN] = useState<number | null>(null);
  const status = source.status ?? "";
  const method = source.crawl_method ?? "unprobed";

  const openReharvest = async () => {
    const count = (await api.post<Record<string, number>>("/etl/console/done-pages", { domains: [source.source_domain] }))[
      source.source_domain
    ];
    if (!count) { toast.info("Nothing harvested yet for this source."); return; }
    setReharvestN(count);
  };

  const items: Item[] = [
    {
      key: "run", label: status === "active" ? "Run harvest" : "Run test sample", icon: <Play className="h-3.5 w-3.5" />,
      reason: !RUNNABLE_STATUSES.includes(status) ? `Source is ${status || "unset"}`
        : !st.hasContract ? "No site contract yet — Remap first"
        : st.runningSince ? `Running since ${fmtTime(st.runningSince)}` : null,
      onSelect: () => run.mutate(source),
    },
    {
      key: "reharvest", label: "Re-harvest", icon: <RotateCcw className="h-3.5 w-3.5" />,
      reason: !st.hasContract ? "No site contract" : !["active", "test_pull"].includes(status) ? "Only for active or test-pull sources" : null,
      onSelect: () => void openReharvest(),
    },
    {
      key: "remap", label: st.hasContract ? "Remap (proposal for review)" : "Remap", icon: <RefreshCw className="h-3.5 w-3.5" />,
      reason: !RUNNABLE_STATUSES.includes(status) ? `Source is ${status || "unset"}`
        : !MAPPABLE_METHODS.includes(method) ? "Run the method check first"
        : st.mapping ? `Mapping in progress${st.mapping.step ? ` (step ${st.mapping.step})` : ""}` : null,
      onSelect: () => remap.mutate(source),
    },
    {
      key: "method", label: "Retry method check", icon: <SearchCheck className="h-3.5 w-3.5" />,
      reason: st.methodCheck ? "Method check in progress" : null,
      onSelect: () => retryMethod.mutate(source),
    },
    {
      key: "contract", label: st.pendingProposal ? "View contract · proposal waiting" : "View contract", icon: <FileSearch className="h-3.5 w-3.5" />,
      reason: !st.hasContract && !st.pendingProposal ? "No site contract yet" : null,
      onSelect: () => setContractOpen(true),
    },
    status === "active"
      ? { key: "pause", label: "Pause", icon: <Pause className="h-3.5 w-3.5" />, reason: null, onSelect: () => setStatus.mutate({ s: source, status: "paused" }) }
      : { key: "activate", label: "Activate", icon: <Play className="h-3.5 w-3.5" />, reason: !st.hasContract ? "No site contract yet" : null, onSelect: () => setStatus.mutate({ s: source, status: "active" }) },
  ];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs">
            Actions <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs">{source.source_domain}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {items.map((it) => (
            <DropdownMenuItem key={it.key} disabled={!!it.reason} onSelect={() => { if (!it.reason) it.onSelect(); }} className="flex items-start gap-2">
              <span className="mt-0.5">{it.icon}</span>
              <span className="flex flex-col">
                <span className="text-xs">{it.label}</span>
                {it.reason ? <span className="text-[10px] text-slate-500">{it.reason}</span> : null}
              </span>
            </DropdownMenuItem>
          ))}
          {onLimits ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onLimits()} className="flex items-center gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5" /> <span className="text-xs">Set limits</span>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {contractOpen ? (
        <SiteContractPanel open={contractOpen} onOpenChange={(o) => { if (!o) setContractOpen(false); }}
          domain={source.source_domain} gcid={source.gcid} sourceId={source.source_id} />
      ) : null}
      <AlertDialog open={reharvestN != null} onOpenChange={(o) => { if (!o && !reharvest.isPending) setReharvestN(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-harvest</AlertDialogTitle>
            <AlertDialogDescription>
              Re-harvest {reharvestN ?? 0} harvested profile pages for {source.source_domain}? They are queued again and a new
              run starts through the field-yield gate. Staged records that are still pending or shallow are updated in place;
              resolved records are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reharvest.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={reharvest.isPending}
              onClick={(e) => { e.preventDefault(); reharvest.mutate(source, { onSettled: () => setReharvestN(null) }); }}>
              Re-harvest
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
