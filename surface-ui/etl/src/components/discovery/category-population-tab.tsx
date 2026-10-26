import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronRight,
  FileSearch,
  Circle,
  Lock,
  Play,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@v3/state/api/server-fn";

import { SiteContractPanel } from "@v3/etl/components/discovery/site-contract-panel";
import { useDiscoverMore, useSourceActions } from "@v3/etl/components/discovery/source-actions";
import { AddWebsitesButton } from "@v3/etl/components/discovery/add-websites-dialog";
import { CategoryBoundaryPanel } from "@v3/etl/components/discovery/category-boundary-panel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@v3/shared/components/ui/tooltip";
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
import { Badge } from "@v3/shared/components/ui/badge";
import { Button } from "@v3/shared/components/ui/button";
import { Checkbox } from "@v3/shared/components/ui/checkbox";
import { Input } from "@v3/shared/components/ui/input";
import { Label } from "@v3/shared/components/ui/label";
import { ReadOnlyLock } from "@v3/shared/components/ui/model-lock";
import { useRole } from "@v3/state/access/roles";
import { cn } from "@v3/shared/components/utils/utils";
import {
  CRAWL_METHOD_LABEL,
  CRAWL_METHOD_REASON,
  CrawlMethodChip,
  isBlockedMethod,
  isReadyMethod,
} from "@v3/etl/components/discovery/crawl-method";

const P = "/etl/console/population";
const rpc = <T = unknown,>(name: string, args: Record<string, unknown>) =>
  api.post<T>(`/etl/console/rpc/${name}`, { args });

type Category = { gcid: string; display_name: string };

type PopSource = {
  source_id: string;
  gcid: string;
  source_domain: string;
  crawl_method: string | null;
  status: string | null;
  notes: string | null;
  role_in_discovery: string | null;
};

type Job = {
  job_id: string;
  gcid: string;
  stage: string | null;
  status: string | null;
  active: boolean | null;
};

type Run = {
  run_id: string;
  source_id: string;
  started_at: string | null;
  finished_at: string | null;
  pages_fetched: number | null;
  staged: number | null;
  created: number | null;
  matched: number | null;
  entities_yielded: number | null;
};

/** Company label: the notes prefix ("RE/MAX — auto-registered…") falls back to the domain. */
function companyName(s: PopSource): string {
  const n = (s.notes ?? "").split("—")[0]?.trim();
  return n && n.length > 1 ? n : s.source_domain;
}

function timeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || Number.isNaN(ms)) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const STEPS = [
  "Activate",
  "Discover companies",
  "Method split",
  "Run + results",
  "Refresh",
] as const;

function stepFromStage(job: Job | null): number {
  if (!job) return 1;
  switch (job.stage) {
    case "identify_companies":
      return 2;
    case "method_split":
      return 3;
    case "harvest":
      return 4;
    default:
      return job.status === "running" ? 2 : 1;
  }
}

export function CategoryPopulationTab() {
  const { canEdit, logAudit } = useRole();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Category | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const { data: matches = [] } = useQuery({
    enabled: q.trim().length >= 2,
    queryKey: ["gbp_category_search", q.trim()],
    // Fix (exact match first, 2026-10-22): the exact name or id comes first, then names starting with the text,
    // then names containing it. "Restaurant" is inside 389 names, and an alphabetical first 12 never reached it.
    queryFn: async () => {
      const term = q.trim();
      // the id / starts-with / contains lookups (the API escapes the pattern and builds the gcid)
      const { byId, starts, contains } = await api.get<{ byId: Category[]; starts: Category[]; contains: Category[] }>(
        `${P}/category-search`,
        { params: { q: term } },
      );
      const asGcid = term.toLowerCase().startsWith("gcid:")
        ? term.toLowerCase()
        : `gcid:${term.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
      const lower = term.toLowerCase();
      const all = [...byId, ...starts, ...contains];
      const exact = all.filter((c) => c.gcid === asGcid || c.display_name.toLowerCase() === lower);
      const seen = new Set<string>();
      return [...exact, ...all].filter((c) => !seen.has(c.gcid) && seen.add(c.gcid)).slice(0, 12);
    },
  });

  const gcid = selected?.gcid ?? null;

  const { data: job = null } = useQuery({
    enabled: !!gcid,
    queryKey: ["etl_job", gcid],
    queryFn: () => api.get<Job | null>(`${P}/job`, { params: { gcid: gcid! } }),
  });

  const { data: sources = [], isLoading: sourcesLoading } = useQuery({
    enabled: !!gcid,
    queryKey: ["etl_pop_sources", gcid],
    queryFn: () => api.get<PopSource[]>(`${P}/sources`, { params: { gcid: gcid! } }),
  });

  const { data: proposal = null } = useQuery({
    enabled: !!gcid,
    queryKey: ["disco_proposal", gcid],
    queryFn: async () => {
      const data = await api.get(`${P}/proposal`, { params: { gcid: gcid! } });
      return data as {
        proposal_id: number;
        payload: {
          companies: Array<{ name: string; domain: string; authority_rank?: number; round?: number; manual?: boolean }>;
          rounds?: number;
        };
        decided_domains: string[];
      } | null;
    },
  });

  // companies not yet decided in an earlier approval round
  const decidedSet = new Set((proposal?.decided_domains ?? []).map((d) => d.toLowerCase()));
  const pendingCompanies = (proposal?.payload?.companies ?? []).filter(
    (c) => !decidedSet.has(c.domain.toLowerCase()),
  );

  const sourceIds = useMemo(() => sources.map((s) => s.source_id), [sources]);

  const { data: runs = [] } = useQuery({
    enabled: sourceIds.length > 0,
    queryKey: ["etl_pop_runs", sourceIds],
    queryFn: () => api.post<Run[]>(`${P}/runs`, { ids: sourceIds }),
  });

  const { data: staged = [] } = useQuery({
    enabled: sourceIds.length > 0,
    queryKey: ["etl_pop_staged", sourceIds],
    // capped at 1000 rows, as the REST read was (docs/BROWSER_TO_API_FOLLOWUPS.md)
    queryFn: async () => {
      const data = await api.post(`${P}/staged`, { ids: sourceIds });
      return data as {
        source_id: string;
        entity_type: string | null;
        resolution_status: string | null;
      }[];
    },
  });

  // classification timestamp per domain, for the "Last checked" label
  const { data: siteContracts = [] } = useQuery({
    enabled: !!gcid,
    queryKey: ["disco_site_contract", gcid],
    queryFn: async () => {
      const data = await api.get(`${P}/site-contracts`, { params: { gcid: gcid! } });
      return data as {
        domain: string;
        learned_at: string | null;
        method_evidence: { where_profiles_live?: string | null } | null;
        detail_pattern: string | null;
        contract_version: number | string | null;
      }[];
    },
  });
  const learnedAtByDomain = new Map(siteContracts.map((c) => [c.domain, c.learned_at]));
  const evidenceByDomain = new Map(siteContracts.map((c) => [c.domain, c.method_evidence]));
  const contractVersionByDomain = new Map(
    siteContracts.map((c) => [
      c.domain,
      c.contract_version == null || isNaN(Number(c.contract_version)) ? null : Number(c.contract_version),
    ]),
  );

  // A real site contract = version 3 with a profile-page pattern (same rule as the
  // run guard in exp_etl_run_source). The method check alone writes a row with
  // only the method, which is not a usable contract.
  const realContractDomains = new Set(
    siteContracts
      .filter((c) => !!c.detail_pattern && (contractVersionByDomain.get(c.domain) ?? 0) >= 3)
      .map((c) => c.domain),
  );
  const hasRealContract = (domain: string) => realContractDomains.has(domain);

  // Sources that passed the method check but have no usable contract yet (their map is queued, running or not asked for).
  const awaitingMapDomains = sources
    .filter((s) => isReadyMethod(s.crawl_method) && !hasRealContract(s.source_domain))
    .map((s) => s.source_domain.toLowerCase());

  // Latest site-map attempt per domain, for the "not mapped yet" reason.
  const { data: mapAttempts = [] } = useQuery({
    enabled: !!gcid,
    queryKey: ["etl_pop_map_attempts", gcid],
    queryFn: async () => {
      const data = await api.get(`${P}/map-attempts`, { params: { gcid: gcid! } });
      return data as {
        request_id: number;
        status: string | null;
        created_at: string | null;
        domain: string | null;
        error: string | null;
        map_step: string | null;
      }[];
    },
    // Fix (map queue status, 2026-10-21): also poll while a source that passed the method check has no map request
    // yet. Approving queues the maps a minute later; the list used to stay on "has not run yet" until a reload.
    refetchInterval: (q) => {
      const rows = (q.state.data as { status: string | null; domain: string | null }[] | undefined) ?? [];
      if (rows.some((r) => r.status === "pending" || r.status === "sent")) return 15000;
      const seen = new Set(rows.map((r) => (r.domain ?? "").toLowerCase()));
      return awaitingMapDomains.some((d) => !seen.has(d)) ? 30000 : false;
    },
  });
  // Per domain: the open map request (waiting or running) if there is one, else the latest attempt.
  const lastMapByDomain = new Map<string, (typeof mapAttempts)[number]>();
  for (const r of mapAttempts) {
    const d = (r.domain ?? "").toLowerCase();
    if (!d) continue;
    const open = r.status === "pending" || r.status === "sent";
    const cur = lastMapByDomain.get(d);
    if (!cur || (open && cur.status !== "pending" && cur.status !== "sent")) lastMapByDomain.set(d, r);
  }
  // queued = waiting for the worker; running = being mapped now (a multi-step map goes back to pending between
  // steps, with its step saved in response.map_step); none = no map asked for yet.
  const mapState = (domain: string): "queued" | "running" | "failed" | "finished" | "none" => {
    const r = lastMapByDomain.get(domain.toLowerCase());
    if (!r) return "none";
    if (r.status === "sent" || (r.status === "pending" && r.map_step)) return "running";
    if (r.status === "pending") return "queued";
    return r.error ? "failed" : "finished";
  };
  const notMappedReason = (domain: string): string => {
    const r = lastMapByDomain.get(domain.toLowerCase());
    switch (mapState(domain)) {
      case "none":
        return "Passed the method check; no site mapping has been requested yet.";
      case "queued":
        return "Passed the method check; site mapping is queued and starts when the worker picks it up.";
      case "running":
        return "Site mapping is running now…";
      case "failed":
        return `Site mapping failed: ${(r?.error ?? "").replace(/^MapSiteError:\s*/, "")}`;
      default:
        return "Site mapping finished without a usable site contract.";
    }
  };
  // When a map finishes, reload the contracts and sources so the card moves to Ready without a page reload.
  const finishedMapsKey = mapAttempts
    .filter((r) => r.status === "completed" || r.status === "error")
    .map((r) => r.request_id)
    .join(",");
  useEffect(() => {
    if (!gcid || !finishedMapsKey) return;
    queryClient.invalidateQueries({ queryKey: ["disco_site_contract", gcid] });
    queryClient.invalidateQueries({ queryKey: ["etl_pop_sources", gcid] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedMapsKey]);

  // Fix (method check status, 2026-10-22): the latest method check per domain, so a card shows "queued" / "running"
  // and Retry is disabled while one is open (same polling rule as the map list above).
  const awaitingMethodDomains = sources
    .filter((s) => !isReadyMethod(s.crawl_method) && !isBlockedMethod(s.crawl_method))
    .map((s) => s.source_domain.toLowerCase());
  const { data: methodAttempts = [] } = useQuery({
    enabled: !!gcid,
    queryKey: ["etl_pop_method_attempts", gcid],
    queryFn: () =>
      api.get<{ request_id: number; status: string | null; domain: string | null }[]>(`${P}/method-attempts`, {
        params: { gcid: gcid! },
      }),
    refetchInterval: (q) => {
      const rows = (q.state.data as { status: string | null; domain: string | null }[] | undefined) ?? [];
      if (rows.some((r) => r.status === "pending" || r.status === "sent")) return 15000;
      const seen = new Set(rows.map((r) => (r.domain ?? "").toLowerCase()));
      return awaitingMethodDomains.some((d) => !seen.has(d)) ? 30000 : false;
    },
  });
  const lastMethodByDomain = new Map<string, (typeof methodAttempts)[number]>();
  for (const r of methodAttempts) {
    const d = (r.domain ?? "").toLowerCase();
    if (d && !lastMethodByDomain.has(d)) lastMethodByDomain.set(d, r);
  }
  const methodState = (domain: string): "queued" | "running" | "none" => {
    const r = lastMethodByDomain.get(domain.toLowerCase());
    return r?.status === "pending" ? "queued" : r?.status === "sent" ? "running" : "none";
  };
  // When a method check finishes, reload the sources so the card moves on without a page reload.
  const finishedMethodsKey = methodAttempts
    .filter((r) => r.status === "completed" || r.status === "error")
    .map((r) => r.request_id)
    .join(",");
  useEffect(() => {
    if (!gcid || !finishedMethodsKey) return;
    queryClient.invalidateQueries({ queryKey: ["etl_pop_sources", gcid] });
    queryClient.invalidateQueries({ queryKey: ["disco_site_contract", gcid] });
    queryClient.invalidateQueries({ queryKey: ["etl_pop_map_attempts", gcid] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedMethodsKey]);

  const sourceDomains = useMemo(() => sources.map((s) => s.source_domain), [sources]);
  const { data: donePagesByDomain = {} } = useQuery({
    enabled: sourceDomains.length > 0,
    queryKey: ["etl_pop_done_pages", sourceDomains],
    queryFn: () => api.post<Record<string, number>>("/etl/console/done-pages", { domains: sourceDomains }),
  });

  // default every discovered company to checked (skipped when empty so a
  // pending proposal's checks are never clobbered by an empty sources list)
  useEffect(() => {
    if (sources.length === 0) return;
    setChecked(Object.fromEntries(sources.map((s) => [s.source_id, s.status !== "paused"])));
  }, [sources]);

  // default only the still-undecided proposed companies to checked
  useEffect(() => {
    if (!proposal) return;
    setChecked(Object.fromEntries(pendingCompanies.map((c) => [c.domain, true])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal]);

  const step = stepFromStage(job);

  const activate = useMutation({
    mutationFn: async () => {
      await rpc("exp_etl_activate_category", { p_gcid: gcid! });
    },
    onSuccess: async () => {
      toast.success(`Population started for ${selected?.display_name}`);
      await logAudit("etl_category_activate", gcid, { category: selected?.display_name });
      queryClient.invalidateQueries({ queryKey: ["etl_job", gcid] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: async () => {
      const ids = sources.filter((s) => checked[s.source_id]).map((s) => s.source_id);
      await rpc("exp_etl_approve_companies", { p_gcid: gcid!, p_source_ids: ids });
      return ids.length;
    },
    onSuccess: async (n) => {
      toast.success(`${n} companies approved`);
      await logAudit("etl_companies_approve", gcid, { approved: n });
      queryClient.invalidateQueries({ queryKey: ["etl_job", gcid] });
      queryClient.invalidateQueries({ queryKey: ["etl_pop_sources", gcid] });
      queryClient.invalidateQueries({ queryKey: ["exp_etl_sources"] });
      queryClient.invalidateQueries({ queryKey: ["etl_pop_map_attempts", gcid] });
      queryClient.invalidateQueries({ queryKey: ["etl_pop_method_attempts", gcid] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmProposal = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("no pending proposal");
      const domains = pendingCompanies
        .map((c) => c.domain)
        .filter((d) => checked[d]);
      await rpc("disco_confirm_companies", { p_proposal_id: proposal.proposal_id, p_approved_domains: domains });
      return domains.length;
    },
    onSuccess: async (n) => {
      toast.success(`${n} companies approved`);
      await logAudit("etl_companies_approve", gcid, { approved: n });
      queryClient.invalidateQueries({ queryKey: ["etl_job", gcid] });
      queryClient.invalidateQueries({ queryKey: ["etl_pop_sources", gcid] });
      queryClient.invalidateQueries({ queryKey: ["exp_etl_sources"] });
      queryClient.invalidateQueries({ queryKey: ["etl_pop_map_attempts", gcid] });
      queryClient.invalidateQueries({ queryKey: ["etl_pop_method_attempts", gcid] });
      queryClient.invalidateQueries({ queryKey: ["disco_proposal", gcid] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Source actions (2026-10-15): the same shared actions as the Source Registry's Actions menu.
  const { run: runSource, reharvest, remap, retryMethod } = useSourceActions();
  const discoverMore = useDiscoverMore();
  // Discovery rounds (2026-10-16): a new round merges into the pending list; only a round still running blocks another.
  const { data: roundRunning = false } = useQuery({
    enabled: !!gcid,
    queryKey: ["disco_discover_running", gcid],
    queryFn: () => api.get<boolean>(`${P}/discover-running`, { params: { gcid: gcid! } }),
    refetchInterval: (q) => (q.state.data ? 20000 : false),
  });

  const [reharvestTarget, setReharvestTarget] = useState<{ s: PopSource; n: number } | null>(null);
  const [contractTarget, setContractTarget] = useState<PopSource | null>(null);
  // Ready to Run = method passed AND a real site contract exists.
  const ready = sources.filter(
    (s) => isReadyMethod(s.crawl_method) && hasRealContract(s.source_domain),
  );
  const notMapped = sources.filter(
    (s) => isReadyMethod(s.crawl_method) && !hasRealContract(s.source_domain),
  );
  const blocked = sources.filter((s) => isBlockedMethod(s.crawl_method));
  const unprobed = sources.filter(
    (s) => !isReadyMethod(s.crawl_method) && !isBlockedMethod(s.crawl_method),
  );

  const latestRun = (id: string) => runs.find((r) => r.source_id === id) ?? null;
  const isPopulated = (id: string) => runs.some((r) => r.source_id === id && r.finished_at);

  const stagedFor = (id: string) => staged.filter((r) => r.source_id === id);

  return (
    <div className="space-y-5">
      <Stepper current={step} />

      {/* STEP 1 — pick + activate */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <StepHeading n={1} title="Activate" done={step > 1} />
        <div className="mt-3 max-w-xl">
          <Label className="text-xs text-slate-500">Category</Label>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={selected ? selected.display_name : q}
              onChange={(e) => {
                setSelected(null);
                setQ(e.target.value);
              }}
              placeholder="Search categories by name…"
              className="pl-9"
            />
          </div>
          {!selected && matches.length > 0 ? (
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {matches.map((c) => (
                <button
                  key={c.gcid}
                  onClick={() => {
                    setSelected(c);
                    setQ(c.display_name);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="text-ink">{c.display_name}</span>
                  <span className="font-mono text-[11px] text-slate-400">{c.gcid}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {selected ? (
          step === 1 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--color-g-blue)] bg-[color:var(--color-g-blue-soft)] px-5 py-4">
              <div>
                <div className="text-base font-semibold text-ink">
                  Populate {selected.display_name} data?
                </div>
                <p className="mt-0.5 text-xs text-slate-600">
                  Activating starts the harvest job for this category and looks for its top
                  companies.
                </p>
              </div>
              {canEdit ? (
                <Button
                  className="gap-1.5"
                  disabled={activate.isPending}
                  onClick={() => activate.mutate()}
                >
                  <Rocket className="h-4 w-4" /> Activate
                </Button>
              ) : (
                <ReadOnlyLock />
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-emerald-700">
              Job active for {selected.display_name} — stage: {job?.stage ?? "—"}
            </p>
          )
        ) : null}
      </section>

      {/* STEP 2 — company checklist */}
      {selected && step >= 2 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <StepHeading n={2} title="Discover companies" done={step > 2} />
          {canEdit ? (
            <div className="mt-2 flex items-center justify-end gap-2">
              {roundRunning ? <span className="text-xs text-slate-500">A discovery round is running — its companies are added here when it finishes.</span> : null}
              <AddWebsitesButton gcid={gcid!} />
              <Button
                size="sm"
                variant="outline"
                disabled={discoverMore.isPending || roundRunning}
                title={roundRunning ? "A discovery round is already running" : undefined}
                onClick={() => discoverMore.mutate(gcid!)}
              >
                {proposal ? "Discover more (adds to this list)" : "Discover more companies"}
              </Button>
            </div>
          ) : null}
          <CategoryBoundaryPanel gcid={gcid!} canEdit={canEdit} />
          <p className="mt-2 text-sm text-slate-600">
            I found these top companies. Uncheck any that aren&apos;t relevant, then approve.
          </p>
          {proposal ? (
            <>
              {proposal.decided_domains.length > 0 ? (
                <p className="mt-1 text-xs text-slate-500">
                  {proposal.decided_domains.length} of {proposal.payload.companies.length}{" "}
                  already approved in an earlier round — {pendingCompanies.length} left to
                  decide.
                </p>
              ) : null}
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">
                  {pendingCompanies.length}{" "}
                  {pendingCompanies.length === 1 ? "company" : "companies"} to review
                </span>
                {canEdit && pendingCompanies.length > 0 ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-[color:var(--color-g-blue)] hover:underline"
                    onClick={() => {
                      const allChecked = pendingCompanies.every((c) => checked[c.domain]);
                      setChecked((prev) => {
                        const next = { ...prev };
                        pendingCompanies.forEach((c) => {
                          next[c.domain] = !allChecked;
                        });
                        return next;
                      });
                    }}
                  >
                    {pendingCompanies.every((c) => checked[c.domain]) ? "Deselect all" : "Select all"}
                  </button>
                ) : null}
              </div>
              <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {pendingCompanies.map((c) => (
                  <label
                    key={c.domain}
                    className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50"
                  >
                    <Checkbox
                      checked={!!checked[c.domain]}
                      disabled={!canEdit}
                      onCheckedChange={(v) =>
                        setChecked((prev) => ({ ...prev, [c.domain]: v === true }))
                      }
                    />
                    <span className="flex-1 text-sm font-medium text-ink">{c.name}</span>
                    <span className="font-mono text-xs text-slate-500">{c.domain}</span>
                    {c.manual ? (
                      <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">manual</span>
                    ) : null}
                    {typeof c.round === "number" && (proposal?.payload?.rounds ?? 1) > 1 ? (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">round {c.round}</span>
                    ) : null}
                    {typeof c.authority_rank === "number" ? (
                      <span className="text-xs text-slate-400">#{c.authority_rank}</span>
                    ) : null}
                  </label>
                ))}
              </div>
              {pendingCompanies.length > 0 ? (
                <div className="mt-3 flex justify-end">
                  {canEdit ? (
                    <Button
                      disabled={confirmProposal.isPending}
                      onClick={() => confirmProposal.mutate()}
                    >
                      Approve
                    </Button>
                  ) : (
                    <ReadOnlyLock />
                  )}
                </div>
              ) : null}
            </>
          ) : sourcesLoading ? (
            <p className="mt-3 text-sm text-slate-500">Loading companies…</p>
          ) : sources.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              No hierarchy sources registered for this category yet — the discovery job registers
              them.
            </p>
          ) : (
            <>
              <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {sources.map((s) => (
                  <label
                    key={s.source_id}
                    className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50"
                  >
                    <Checkbox
                      checked={!!checked[s.source_id]}
                      disabled={step > 2 || !canEdit}
                      onCheckedChange={(v) =>
                        setChecked((c) => ({ ...c, [s.source_id]: v === true }))
                      }
                    />
                    <span className="flex-1 text-sm font-medium text-ink">{companyName(s)}</span>
                    <span className="font-mono text-xs text-slate-500">{s.source_domain}</span>
                    <CrawlMethodChip method={s.crawl_method} />
                  </label>
                ))}
              </div>
              {step === 2 ? (
                <div className="mt-3 flex justify-end">
                  {canEdit ? (
                    <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
                      Approve
                    </Button>
                  ) : (
                    <ReadOnlyLock />
                  )}
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* STEP 3 — method split */}
      {selected && step >= 3 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <StepHeading n={3} title="Method split" done={false} />
          <p className="mt-2 text-sm text-slate-600">
            {ready.length} ready, {blocked.length + unprobed.length} blocked
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-emerald-800">
                  Ready — free server crawl
                </h3>
                {canEdit && ready.length > 0 ? (
                  <Button
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    disabled={runSource.isPending}
                    onClick={() => ready.forEach((s) => runSource.mutate(s))}
                  >
                    <Play className="h-3 w-3" /> Run all ready
                  </Button>
                ) : null}
              </div>
              {ready.length === 0 ? (
                <p className="mt-2 text-xs text-emerald-800/70">
                  No server-crawlable companies in this category.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {ready.map((s) => {
                    const run = latestRun(s.source_id);
                    const populated = isPopulated(s.source_id);
                    return (
                      <div
                        key={s.source_id}
                        className="rounded-lg border border-emerald-200 bg-white px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex-1 text-sm font-medium text-ink">
                            {companyName(s)}
                          </span>
                          <span className="font-mono text-[11px] text-slate-500">
                            {s.source_domain}
                          </span>
                          {populated ? (
                            <Badge
                              variant="secondary"
                              className="bg-emerald-100 font-normal text-emerald-800"
                            >
                              Populated
                            </Badge>
                          ) : null}
                          {canEdit ? (
                            populated ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 px-2 text-xs"
                                disabled={runSource.isPending}
                                onClick={() => runSource.mutate(s)}
                              >
                                <RefreshCw className="h-3 w-3" /> Refresh
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                className="h-7 gap-1 px-2 text-xs"
                                disabled={runSource.isPending}
                                onClick={() => runSource.mutate(s)}
                              >
                                <Play className="h-3 w-3" /> Run
                              </Button>
                            )
                          ) : null}
                          {canEdit ? (() => {
                            const ver = contractVersionByDomain.get(s.source_domain) ?? null;
                            const n = donePagesByDomain[s.source_domain] ?? 0;
                            const reason =
                              ver == null || ver < 3
                                ? "No site contract"
                                : n === 0
                                  ? "Nothing harvested yet"
                                  : null;
                            const btn = (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 px-2 text-xs"
                                disabled={!!reason || reharvest.isPending}
                                onClick={() => setReharvestTarget({ s, n })}
                              >
                                <RotateCcw className="h-3 w-3" /> Re-harvest
                              </Button>
                            );
                            return reason ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span tabIndex={0}>{btn}</span>
                                </TooltipTrigger>
                                <TooltipContent>{reason}</TooltipContent>
                              </Tooltip>
                            ) : (
                              btn
                            );
                          })() : null}
                          {(() => {
                            const has = hasRealContract(s.source_domain);
                            const btn = (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 px-2 text-xs"
                                disabled={!has}
                                onClick={() => setContractTarget(s)}
                              >
                                <FileSearch className="h-3 w-3" /> View contract
                              </Button>
                            );
                            return has ? btn : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span tabIndex={0}>{btn}</span>
                                </TooltipTrigger>
                                <TooltipContent>No site contract</TooltipContent>
                              </Tooltip>
                            );
                          })()}
                        </div>

                        {run ? (
                          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                            <Metric label="Pages" value={run.pages_fetched} />
                            <Metric label="Staged" value={run.staged} />
                            <Metric
                              label="Professionals"
                              value={
                                stagedFor(s.source_id).filter(
                                  (r) => r.entity_type === "professional",
                                ).length
                              }
                            />
                            <Metric
                              label="Offices"
                              value={
                                stagedFor(s.source_id).filter((r) => r.entity_type === "location")
                                  .length
                              }
                            />
                            <Metric label="Dedup merges" value={run.matched} />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <h3 className="text-sm font-semibold text-amber-800">
                Not ready — blocked or not mapped
              </h3>
              {notMapped.length + blocked.length + unprobed.length === 0 ? (
                <p className="mt-2 text-xs text-amber-800/70">Nothing blocked — nice.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {[...notMapped, ...blocked, ...unprobed].map((s) => {
                    const isNotMapped = notMapped.includes(s);
                    const ms = isNotMapped ? mapState(s.source_domain) : null;
                    const mapOpen = ms === "queued" || ms === "running";
                    const mts = !isNotMapped ? methodState(s.source_domain) : null;
                    const methodOpen = mts === "queued" || mts === "running";
                    // Fix (not-approved wording, 2026-10-22): a proposed source (for example an older seeded row with a crawl
                    // method already set) is not approved, so it says so instead of "Passed the method check".
                    const notApproved = s.status === "proposed";
                    return (
                    <div
                      key={s.source_id}
                      className="rounded-lg border border-amber-200 bg-white px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <Lock className="h-3.5 w-3.5 text-amber-600" />
                        <span className="flex-1 text-sm font-medium text-ink">
                          {companyName(s)}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {s.source_domain}
                        </span>
                        <Badge
                          variant="secondary"
                          className="bg-amber-100 font-normal text-amber-800"
                        >
                          {notApproved
                            ? "Not approved"
                            : isNotMapped
                            ? ms === "queued"
                              ? "Mapping queued"
                              : ms === "running"
                                ? "Mapping now"
                                : "Not mapped"
                            : mts === "queued"
                              ? "Check queued"
                              : mts === "running"
                                ? "Checking now"
                                : CRAWL_METHOD_LABEL[s.crawl_method ?? "unprobed"] ?? s.crawl_method}
                        </Badge>
                        {canEdit ? (
                          isNotMapped ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 px-2 text-xs"
                              disabled={remap.isPending || mapOpen || s.status !== "approved"}
                              title={mapOpen ? "A site map is already queued or running for this source" : s.status !== "approved" ? "Only an approved source can be mapped" : undefined}
                              onClick={() => remap.mutate(s)}
                            >
                              <RefreshCw className="h-3 w-3" /> Remap
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 px-2 text-xs"
                              disabled={retryMethod.isPending || methodOpen}
                              title={methodOpen ? "A method check is already queued or running for this source" : undefined}
                              onClick={() => retryMethod.mutate(s)}
                            >
                              <RefreshCw className="h-3 w-3" /> Retry
                            </Button>
                          )
                        ) : null}
                      </div>
                      <p className="mt-1 pl-6 text-xs text-slate-600">
                        {notApproved
                          ? "Not approved yet. Approve it in the company list to start the method check and mapping."
                          : isNotMapped
                          ? notMappedReason(s.source_domain)
                          : mts === "queued"
                            ? "Method check is queued and starts when the worker picks it up."
                            : mts === "running"
                              ? "Method check is running now…"
                              : CRAWL_METHOD_REASON[s.crawl_method ?? "unprobed"]}
                      </p>
                      {s.crawl_method === "no_profiles_on_site" &&
                      evidenceByDomain.get(s.source_domain)?.where_profiles_live ? (
                        <p className="mt-0.5 pl-6 text-[11px] text-slate-600">
                          Where profiles are: {evidenceByDomain.get(s.source_domain)?.where_profiles_live}
                        </p>
                      ) : null}
                      {timeAgo(learnedAtByDomain.get(s.source_domain)) ? (
                        <p className="mt-0.5 pl-6 text-[11px] text-slate-400">
                          Last checked: {timeAgo(learnedAtByDomain.get(s.source_domain))}
                        </p>
                      ) : null}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/* STEP 5 — refresh */}
      {selected && step >= 3 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <StepHeading n={5} title="Refresh" done={false} />
          <p className="mt-2 text-sm text-slate-600">
            Refreshes are manual — click to update this source&apos;s profiles. Nothing
            auto-refreshes.
          </p>
          <div className="mt-3 flex items-center gap-3">
            {canEdit ? (
              <Button
                variant="outline"
                className="gap-1.5"
                disabled={runSource.isPending || ready.filter((s) => isPopulated(s.source_id)).length === 0}
                onClick={() =>
                  ready.filter((s) => isPopulated(s.source_id)).forEach((s) => runSource.mutate(s))
                }
              >
                <RefreshCw className="h-4 w-4" /> Refresh all
              </Button>
            ) : (
              <ReadOnlyLock />
            )}
            <span className="text-xs text-slate-500">
              {ready.filter((s) => isPopulated(s.source_id)).length} populated source(s) · idle by
              default
            </span>
          </div>
        </section>
      ) : null}

      {contractTarget && gcid ? (
        <SiteContractPanel
          open={!!contractTarget}
          onOpenChange={(o) => { if (!o) setContractTarget(null); }}
          domain={contractTarget.source_domain}
          gcid={gcid}
          sourceId={contractTarget.source_id}
        />
      ) : null}
      <AlertDialog
        open={!!reharvestTarget}
        onOpenChange={(o) => {
          if (!o && !reharvest.isPending) setReharvestTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-harvest</AlertDialogTitle>
            <AlertDialogDescription>
              Re-harvest {reharvestTarget?.n ?? 0} harvested profile pages for{" "}
              {reharvestTarget?.s.source_domain}? They are queued again and a new run starts through
              the field-yield gate. Staged records that are still pending or shallow are updated in
              place; resolved records are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reharvest.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reharvest.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (reharvestTarget) reharvest.mutate(reharvestTarget.s, { onSettled: () => setReharvestTarget(null) });
              }}
            >
              Re-harvest
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-3">
      {STEPS.map((s, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "active" : "todo";
        return (
          <div key={s} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                state === "done" && "bg-emerald-50 text-emerald-700",
                state === "active" && "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
                state === "todo" && "bg-slate-50 text-slate-400",
              )}
            >
              {state === "done" ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Circle className="h-3.5 w-3.5" />
              )}
              {n}. {s}
            </span>
            {n < STEPS.length ? <ChevronRight className="h-3.5 w-3.5 text-slate-300" /> : null}
          </div>
        );
      })}
    </div>
  );
}

function StepHeading({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
        {n}
      </span>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600">{title}</h2>
      {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md bg-slate-50 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-ink">{value ?? 0}</div>
    </div>
  );
}
