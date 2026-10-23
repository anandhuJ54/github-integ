import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpDown, Check, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { DataTable, EmptyState, Panel } from "@/components/console/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadCategoryGroups } from "@/lib/category-groups";
import {
  GEO_SCOPES,
  TERRITORY_TIERS,
  TIER_LABEL,
  approveProposal,
  deleteTerritory,
  loadAllTerritories,
  loadProposals,
  loadTerritoryReps,
  proposeTerritories,
  rejectProposal,
  saveTerritory,
  searchBrands,
  setLaneOwner,
  type Lane,
  type TerritoryListRow,
  type TerritoryProposal,
  type TerritoryRep,
} from "@/lib/territories";

const nf = new Intl.NumberFormat("en-US");
const cf = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const ALL = "__all";
const NONE = "__none";

export const TERRITORY_KEYS = ["all-territories", "territory-proposals", "cat-groups-overview"];

export function useInvalidateTerritories() {
  const qc = useQueryClient();
  return () => {
    for (const k of TERRITORY_KEYS) qc.invalidateQueries({ queryKey: [k] });
    qc.invalidateQueries({ queryKey: ["territory-row"] });
  };
}

export function geoLabel(t: { geo_scope: string | null; region: string | null }) {
  const scope = t.geo_scope ?? "national";
  return scope === "region" ? `Region · ${t.region ?? "—"}` : "National";
}

export function OwnerLink({ rep }: { rep: TerritoryRep | null }) {
  if (!rep) return <span className="text-[color:var(--color-ink-3)]">Open</span>;
  return (
    <Link
      to="/sales/sellers/$repId"
      params={{ repId: rep.id }}
      className="font-medium text-[color:var(--color-g-blue)] hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {rep.name}
    </Link>
  );
}

/* ─────────── Lane owner picker (one owner per lane) ─────────── */
export function LaneOwnerSelect({
  territory,
  lane,
  reps,
}: {
  territory: TerritoryListRow;
  lane: Lane;
  reps: TerritoryRep[];
}) {
  const invalidate = useInvalidateTerritories();
  const current = lane === "seller" ? territory.seller : territory.sre;
  const pool = reps.filter((r) => (lane === "sre" ? /^(srx|sre)$/i.test(r.role ?? "") : !/^(srx|sre)$/i.test(r.role ?? "")));
  const m = useMutation({
    mutationFn: (repId: string | null) =>
      setLaneOwner({
        territoryId: territory.id,
        groupKey: territory.group_key ?? "",
        tier: territory.tier,
        lane,
        repId,
      }),
    onSuccess: () => {
      toast.success(`${lane === "seller" ? "Seller" : "SRE"} updated`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Select
      value={current?.id ?? NONE}
      onValueChange={(v) => m.mutate(v === NONE ? null : v)}
      disabled={m.isPending}
    >
      <SelectTrigger className="h-8 w-[200px] text-xs" onClick={(e) => e.stopPropagation()}>
        <SelectValue placeholder={lane === "seller" ? "Assign seller" : "Assign SRE"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Unassigned</SelectItem>
        {pool.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.name}
            {r.is_demo ? " (demo)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ─────────── Create / edit form ─────────── */
export function TerritoryFormDialog({
  open,
  onOpenChange,
  editing,
  defaultGroup,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing?: TerritoryListRow | null;
  defaultGroup?: string;
  onSaved?: (id: string) => void;
}) {
  const invalidate = useInvalidateTerritories();
  const groups = useQuery({ queryKey: ["cat-groups"], queryFn: loadCategoryGroups });
  const [groupKey, setGroupKey] = useState(editing?.group_key ?? defaultGroup ?? "");
  const [tier, setTier] = useState<string>(editing?.tier ?? "SMB");
  const [geo, setGeo] = useState<string>(editing?.geo_scope ?? "national");
  const [region, setRegion] = useState(editing?.region ?? "");
  const [label, setLabel] = useState(editing?.label ?? "");
  const [brandTerm, setBrandTerm] = useState("");
  const [brand, setBrand] = useState<{ id: string; name: string } | null>(null);
  const brands = useQuery({
    queryKey: ["brand-search", brandTerm],
    queryFn: () => searchBrands(brandTerm),
    enabled: brandTerm.trim().length >= 2 && !brand,
  });
  const m = useMutation({
    mutationFn: () =>
      saveTerritory({
        id: editing?.id,
        group_key: groupKey,
        tier,
        geo_scope: geo,
        region: region || null,
        label: label || null,
        brandOrgId: brand?.id ?? null,
      }),
    onSuccess: (id) => {
      toast.success(editing ? "Territory updated" : "Territory created");
      invalidate();
      onOpenChange(false);
      onSaved?.(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit territory" : "New territory"}</DialogTitle>
          <DialogDescription>
            Dimensions: category group × tier × geography, with an optional brand.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Category group</Label>
            <Select value={groupKey} onValueChange={setGroupKey}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a group" />
              </SelectTrigger>
              <SelectContent>
                {(groups.data ?? []).map((g) => (
                  <SelectItem key={g.group_key} value={g.group_key}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Tier</Label>
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TERRITORY_TIERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIER_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Geography</Label>
              <Select value={geo} onValueChange={setGeo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GEO_SCOPES.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g === "national" ? "National" : "Region"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {geo === "region" ? (
            <div className="grid gap-1.5">
              <Label>Region</Label>
              <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. TX, Southeast" />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label>Label (optional — generated when blank)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Brand (optional)</Label>
            {brand ? (
              <div className="flex items-center justify-between rounded-md border border-[color:var(--color-hairline)] px-3 py-2 text-sm">
                {brand.name}
                <Button size="sm" variant="ghost" onClick={() => setBrand(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <Input value={brandTerm} onChange={(e) => setBrandTerm(e.target.value)} placeholder="Search brands…" />
                {(brands.data ?? []).length ? (
                  <div className="max-h-40 overflow-auto rounded-md border border-[color:var(--color-hairline)]">
                    {(brands.data ?? []).map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[color:var(--color-surface-2)]"
                        onClick={() => setBrand(b)}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!groupKey || m.isPending} onClick={() => m.mutate()}>
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteTerritoryButton({
  territory,
  onDeleted,
}: {
  territory: TerritoryListRow;
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const invalidate = useInvalidateTerritories();
  const m = useMutation({
    mutationFn: () => deleteTerritory(territory.id),
    onSuccess: () => {
      toast.success("Territory deleted");
      invalidate();
      setOpen(false);
      onDeleted?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), setOpen(true))} aria-label="Delete territory">
        <Trash2 className="h-4 w-4" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {territory.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the territory, its Seller and SRE assignments, its ramp and its brand links.
              {territory.seller || territory.sre ? " It currently has an owner." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => (e.preventDefault(), m.mutate())} disabled={m.isPending}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─────────── All Territories tab ─────────── */
type SortKey = "label" | "group" | "tier" | "quota" | "agents" | "logos" | "status";

export function AllTerritoriesTab() {
  const list = useQuery({ queryKey: ["all-territories"], queryFn: loadAllTerritories });
  const reps = useQuery({ queryKey: ["territory-reps"], queryFn: loadTerritoryReps });
  const [group, setGroup] = useState(ALL);
  const [tier, setTier] = useState(ALL);
  const [lane, setLane] = useState(ALL);
  const [owner, setOwner] = useState(ALL);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "group", dir: 1 });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TerritoryListRow | null>(null);

  const rows = list.data ?? [];
  const groupOpts = useMemo(
    () => [...new Map(rows.map((r) => [r.group_key ?? "", r.groupLabel])).entries()],
    [rows],
  );
  const filtered = useMemo(() => {
    const f = rows.filter((r) => {
      if (group !== ALL && r.group_key !== group) return false;
      if (tier !== ALL && r.tier !== tier) return false;
      if (lane === "seller" && r.tier === "SRE") return false;
      if (lane === "sre" && !(r.tier === "SRE" || r.sre)) return false;
      if (owner === NONE && (r.seller || r.sre)) return false;
      if (owner !== ALL && owner !== NONE && r.seller?.id !== owner && r.sre?.id !== owner) return false;
      return true;
    });
    const val = (r: TerritoryListRow): string | number => {
      switch (sort.key) {
        case "label": return r.label ?? "";
        case "group": return `${r.groupLabel}|${r.tier}|${String(r.seq ?? 0).padStart(4, "0")}`;
        case "tier": return TERRITORY_TIERS.indexOf(r.tier as never);
        case "quota": return r.quotaTarget ?? -1;
        case "agents": return r.agent_count ?? 0;
        case "logos": return r.brand_count ?? 0;
        case "status": return r.status ?? "";
      }
    };
    return [...f].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, group, tier, lane, owner, sort]);

  const H = ({ k, children }: { k: SortKey; children: string }) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-ink"
      onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : 1 }))}
    >
      {children}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  const repList = reps.data ?? [];

  return (
    <Panel
      title="All territories"
      description="Every territory across every category group. Each logo has two owners — a Seller (logo lane) and an SRE (individuals lane)."
      actions={
        <Button size="sm" onClick={() => (setEditing(null), setFormOpen(true))}>
          <Plus className="mr-1 h-4 w-4" /> New territory
        </Button>
      }
      bodyClassName="px-3 py-2"
    >
      <div className="mb-3 flex flex-wrap gap-2 px-1">
        <FilterSelect value={group} onChange={setGroup} placeholder="Category group"
          options={[[ALL, "All groups"], ...groupOpts]} />
        <FilterSelect value={tier} onChange={setTier} placeholder="Tier"
          options={[[ALL, "All tiers"], ...TERRITORY_TIERS.map((t) => [t, t] as [string, string])]} />
        <FilterSelect value={lane} onChange={setLane} placeholder="Lane"
          options={[[ALL, "Both lanes"], ["seller", "Seller lane"], ["sre", "SRE lane"]]} />
        <FilterSelect value={owner} onChange={setOwner} placeholder="Owner"
          options={[[ALL, "Any owner"], [NONE, "No owner"], ...repList.map((r) => [r.id, r.name] as [string, string])]} />
        <span className="ml-auto self-center text-xs text-[color:var(--color-ink-3)]">
          {nf.format(filtered.length)} of {nf.format(rows.length)}
        </span>
      </div>
      <DataTable<TerritoryListRow>
        loading={list.isLoading}
        rows={filtered}
        getRowKey={(r) => r.id}
        empty={
          <EmptyState
            compact
            title={rows.length ? "No territories match these filters" : "No territories yet"}
            description={rows.length ? "Clear a filter to see more." : "Create one, or propose splits from the Review queue."}
          />
        }
        columns={[
          {
            key: "label",
            header: <H k="label">Territory</H>,
            cell: (r) => (
              <Link
                to="/sales/territory/$territoryId"
                params={{ territoryId: r.id }}
                className="font-mono text-xs font-medium text-[color:var(--color-g-blue)] hover:underline"
              >
                {r.label}
              </Link>
            ),
          },
          {
            key: "group",
            header: <H k="group">Category group</H>,
            cell: (r) =>
              r.group_key ? (
                <Link to="/sales/territories/$groupKey" params={{ groupKey: r.group_key }} className="hover:underline">
                  {r.groupLabel}
                </Link>
              ) : (
                "—"
              ),
          },
          { key: "tier", header: <H k="tier">Tier</H>, cell: (r) => r.tier },
          { key: "geo", header: "Geography", cell: (r) => geoLabel(r) },
          { key: "seller", header: "Seller", cell: (r) => (r.tier === "SRE" ? <span className="text-[color:var(--color-ink-3)]">n/a</span> : <OwnerLink rep={r.seller} />) },
          { key: "sre", header: "SRE", cell: (r) => <OwnerLink rep={r.sre} /> },
          { key: "quota", header: <H k="quota">Quota</H>, align: "right", cell: (r) => (r.quotaTarget ? cf.format(r.quotaTarget) : "—") },
          { key: "ramp", header: "Ramp", cell: (r) => <span className="text-xs">{r.rampStatus}</span> },
          { key: "logos", header: <H k="logos">Logos</H>, align: "right", cell: (r) => nf.format(r.brand_count ?? 0) },
          { key: "agents", header: <H k="agents">Agents</H>, align: "right", cell: (r) => nf.format(r.agent_count ?? 0) },
          { key: "status", header: <H k="status">Status</H>, cell: (r) => <span className="text-xs">{r.status}</span> },
          {
            key: "act",
            header: "",
            align: "right",
            cell: (r) => (
              <span className="inline-flex">
                <Button size="sm" variant="ghost" aria-label="Edit territory" onClick={() => (setEditing(r), setFormOpen(true))}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <DeleteTerritoryButton territory={r} />
              </span>
            ),
          },
        ]}
      />
      {formOpen ? (
        <TerritoryFormDialog
          key={editing?.id ?? "new"}
          open={formOpen}
          onOpenChange={setFormOpen}
          editing={editing}
          defaultGroup={group !== ALL ? group : undefined}
        />
      ) : null}
    </Panel>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[180px] text-sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v || "_"} value={v || "_none_group"}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ─────────── Review queue (propose-then-approve) ─────────── */
export function ReviewQueueTab() {
  const invalidate = useInvalidateTerritories();
  const groups = useQuery({ queryKey: ["cat-groups"], queryFn: loadCategoryGroups });
  const pending = useQuery({ queryKey: ["territory-proposals", "pending"], queryFn: () => loadProposals("pending") });
  const recent = useQuery({ queryKey: ["territory-proposals", "all"], queryFn: () => loadProposals() });
  const [groupKey, setGroupKey] = useState("");

  const propose = useMutation({
    mutationFn: () => proposeTerritories(groupKey),
    onSuccess: (n) => {
      toast.success(n ? `${n} proposal${n === 1 ? "" : "s"} added for review` : "No new proposals — coverage matches the rules");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const approve = useMutation({
    mutationFn: (p: TerritoryProposal) => approveProposal(p),
    onSuccess: () => (toast.success("Approved and applied"), invalidate()),
    onError: (e: Error) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: (id: string) => rejectProposal(id),
    onSuccess: () => (toast.success("Rejected"), invalidate()),
    onError: (e: Error) => toast.error(e.message),
  });
  const groupLabel = new Map((groups.data ?? []).map((g) => [g.group_key, g.label]));
  const reviewed = (recent.data ?? []).filter((p) => p.state !== "pending").slice(0, 20);

  return (
    <div className="grid gap-6">
      <Panel
        title="Propose territories"
        description="Compares each group's logo and agent volume against exp_territory_rules and finds coverage gaps. Writes pending proposals only — nothing is applied until approved."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Select value={groupKey} onValueChange={setGroupKey}>
            <SelectTrigger className="h-9 w-[260px]">
              <SelectValue placeholder="Choose a category group" />
            </SelectTrigger>
            <SelectContent>
              {(groups.data ?? []).map((g) => (
                <SelectItem key={g.group_key} value={g.group_key}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled={!groupKey || propose.isPending} onClick={() => propose.mutate()}>
            <Sparkles className="mr-1 h-4 w-4" /> Propose territories
          </Button>
        </div>
      </Panel>

      <Panel title="Review queue" description="Pending proposals. Approve creates the territory (and its lane owner when named); Reject closes it." bodyClassName="px-3 py-2">
        <DataTable<TerritoryProposal>
          loading={pending.isLoading}
          rows={pending.data ?? []}
          getRowKey={(p) => p.id}
          empty={<EmptyState compact title="Nothing to review" description="Run Propose territories for a group to generate candidates." />}
          columns={[
            { key: "l", header: "Proposed territory", cell: (p) => <span className="font-mono text-xs">{p.proposed_label}</span> },
            { key: "g", header: "Group", cell: (p) => groupLabel.get(p.group_key ?? "") ?? p.group_key },
            { key: "t", header: "Tier", cell: (p) => p.proposed_tier },
            { key: "lane", header: "Lane", cell: (p) => (p.lane === "sre" ? "SRE" : "Seller") },
            { key: "geo", header: "Geography", cell: (p) => p.proposed_geo ?? "national" },
            { key: "r", header: "Rationale", cell: (p) => <span className="text-xs text-[color:var(--color-ink-2)]">{p.rationale}</span> },
            {
              key: "a",
              header: "",
              align: "right",
              cell: (p) => (
                <span className="inline-flex gap-1">
                  <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(p)}>
                    <Check className="mr-1 h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={reject.isPending} onClick={() => reject.mutate(p.id)}>
                    Reject
                  </Button>
                </span>
              ),
            },
          ]}
        />
      </Panel>

      <Panel title="Recently reviewed" bodyClassName="px-3 py-2">
        <DataTable<TerritoryProposal>
          loading={recent.isLoading}
          rows={reviewed}
          getRowKey={(p) => p.id}
          empty={<EmptyState compact title="No reviewed proposals yet" />}
          columns={[
            { key: "l", header: "Territory", cell: (p) => <span className="font-mono text-xs">{p.proposed_label}</span> },
            { key: "s", header: "Decision", cell: (p) => p.state },
            {
              key: "ap",
              header: "Applied",
              cell: (p) =>
                p.payload?.applied_territory_id ? (
                  <Link to="/sales/territory/$territoryId" params={{ territoryId: p.payload.applied_territory_id }} className="text-[color:var(--color-g-blue)] hover:underline">
                    Open
                  </Link>
                ) : (
                  "—"
                ),
            },
            { key: "d", header: "Reviewed", cell: (p) => (p.reviewed_at ? new Date(p.reviewed_at).toLocaleString() : "—") },
          ]}
        />
      </Panel>
    </div>
  );
}
