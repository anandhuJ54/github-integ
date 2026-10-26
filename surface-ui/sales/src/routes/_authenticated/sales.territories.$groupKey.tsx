import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, RefreshCw, Trash2, Users } from "lucide-react";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/ui/components/console/primitives";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Label } from "@v3/ui/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v3/ui/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import { Switch } from "@v3/ui/components/ui/switch";
import { DemoChip } from "@v3/sales/routes/_authenticated/sales.territories.index";
import {
  addGroupMember,
  assignGroupTerritory,
  generateGroupTerritories,
  loadCategoryGroups,
  loadGroupMembers,
  loadGroupQuotas,
  loadGroupScorecard,
  loadGroupTerritories,
  removeGroupMember,
  searchCategories,
  type GroupMember,
  type GroupSellerCard,
} from "@v3/sales/lib/category-groups";
import {
  TIER_LABEL,
  currentPeriodStart,
  loadTerritoryReps,
  loadTerritoryRules,
  routingExplainer,
  setRepBackup,
  setRepDuty,
  unassignTerritory,
  type TerritoryRep,
  type TerritorySlot,
} from "@v3/sales/lib/territories";

export const Route = createFileRoute("/_authenticated/sales/territories/$groupKey")({
  head: () => ({
    meta: [
      { title: "Group territories — Experience.com Console" },
      {
        name: "description",
        content:
          "Manage a sales team's category bundle: member categories, territory slots by tier, seller onboarding and the consolidated team scorecard.",
      },
      { property: "og:title", content: "Group territories — Experience.com Console" },
      {
        property: "og:description",
        content: "Members editor, tiered territory slots, onboarding and consolidated reporting.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GroupDetailPage,
});

const nf = new Intl.NumberFormat("en-US");
const cf = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const TIER_ORDER = ["ENT", "MM", "SMB", "SRE", "CATCHALL"];

function TierChip({ tier }: { tier: string }) {
  const tones: Record<string, string> = {
    ENT: "bg-[#f0e8ff] text-[#5b21b6]",
    MM: "bg-[#e6f0fe] text-[#1a56c4]",
    SMB: "bg-[#e7f5ec] text-[#1e8e3e]",
    SRE: "bg-[#fff4d6] text-[#8a5a00]",
    CATCHALL: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tones[tier] ?? tones.CATCHALL}`}>
      {tier}
    </span>
  );
}

function GroupDetailPage() {
  const { groupKey } = Route.useParams();
  const qc = useQueryClient();
  const period = currentPeriodStart();

  const groups = useQuery({ queryKey: ["cat-groups"], queryFn: loadCategoryGroups });
  const group = groups.data?.find((g) => g.group_key === groupKey) ?? null;
  const members = useQuery({ queryKey: ["group-members", groupKey], queryFn: () => loadGroupMembers(groupKey) });
  const slots = useQuery({ queryKey: ["group-terr", groupKey], queryFn: () => loadGroupTerritories(groupKey) });
  const reps = useQuery({ queryKey: ["territory-reps"], queryFn: loadTerritoryReps });
  const quotas = useQuery({ queryKey: ["group-quotas", groupKey], queryFn: () => loadGroupQuotas(groupKey) });
  const board = useQuery({ queryKey: ["group-scorecard", groupKey], queryFn: () => loadGroupScorecard(groupKey) });
  const rules = useQuery({ queryKey: ["territory-rules"], queryFn: loadTerritoryRules });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["group-terr", groupKey] });
    void qc.invalidateQueries({ queryKey: ["group-quotas", groupKey] });
    void qc.invalidateQueries({ queryKey: ["group-scorecard", groupKey] });
    void qc.invalidateQueries({ queryKey: ["cat-groups-overview"] });
  };

  const regen = useMutation({
    mutationFn: () => generateGroupTerritories(groupKey),
    onSuccess: () => {
      toast.success("Territories regenerated from real volume across member categories");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addMember = useMutation({
    mutationFn: (gcid: string) => addGroupMember(groupKey, gcid),
    onSuccess: () => {
      toast.success("Category added — regenerate territories to pick up its volume");
      void qc.invalidateQueries({ queryKey: ["group-members", groupKey] });
      void qc.invalidateQueries({ queryKey: ["cat-groups-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const dropMember = useMutation({
    mutationFn: (id: string) => removeGroupMember(id),
    onSuccess: () => {
      toast.success("Category removed — regenerate territories to re-balance");
      void qc.invalidateQueries({ queryKey: ["group-members", groupKey] });
      void qc.invalidateQueries({ queryKey: ["cat-groups-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assign = useMutation({
    mutationFn: (v: { territoryId: string; repId: string; quotaTarget: number | null }) =>
      assignGroupTerritory({ ...v, groupKey }),
    onSuccess: () => {
      toast.success("Seller assigned — quota written against this group");
      setOnboard(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const unassign = useMutation({
    mutationFn: (id: string) => unassignTerritory(id),
    onSuccess: () => {
      toast.success("Slot is open again");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const duty = useMutation({
    mutationFn: (v: { id: string; on: boolean }) => setRepDuty(v.id, v.on),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["territory-reps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const backup = useMutation({
    mutationFn: (v: { id: string; backup: string | null }) => setRepBackup(v.id, v.backup),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["territory-reps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* members editor */
  const [term, setTerm] = useState("");
  const search = useQuery({
    queryKey: ["cat-search", term],
    queryFn: () => searchCategories(term),
    enabled: term.trim().length >= 2,
  });

  /* onboarding dialog */
  const [onboard, setOnboard] = useState(false);
  const [slotId, setSlotId] = useState<string>("");
  const [repId, setRepId] = useState<string>("");
  const [quota, setQuota] = useState<string>("50000");

  const rows = slots.data ?? [];
  const openSlots = rows.filter((s) => !s.seller_id);
  const byTier = useMemo(() => {
    const m = new Map<string, TerritorySlot[]>();
    for (const s of rows) m.set(s.tier, [...(m.get(s.tier) ?? []), s]);
    return [...m.entries()].sort((a, b) => TIER_ORDER.indexOf(a[0]) - TIER_ORDER.indexOf(b[0]));
  }, [rows]);

  const repName = (id: string | null) => reps.data?.find((r) => r.id === id)?.name ?? null;
  const quotaFor = (repIdIn: string | null) => {
    if (!repIdIn) return null;
    const q = (quotas.data ?? []).find((r) => r.rep_id === repIdIn && r.period_start === period);
    return q ? Number(q.target ?? 0) : null;
  };
  const assignedReps = [...new Set(rows.map((s) => s.seller_id).filter(Boolean))] as string[];
  const explain = routingExplainer(rules.data ?? []);

  return (
    <PageBody>
      <PageHeader
        eyebrow="Growth Hub · Territories"
        title={group?.label ?? groupKey}
        description={
          group?.description ??
          "This team owns every category in the bundle below; volume, slots and quota consolidate by group_key."
        }
        actions={
          <div className="flex items-center gap-2">
            <Link
              to="/sales/territories"
              className="text-xs font-semibold text-[color:var(--color-g-blue)] hover:underline"
            >
              All groups
            </Link>
            <Button variant="outline" size="sm" onClick={() => regen.mutate()} disabled={regen.isPending}>
              <RefreshCw className="mr-2 h-4 w-4" /> Regenerate territories
            </Button>
            <Button size="sm" onClick={() => setOnboard(true)} disabled={!openSlots.length}>
              <Plus className="mr-2 h-4 w-4" /> Add seller
            </Button>
          </div>
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Member categories"
          tone="blue"
          loading={members.isLoading}
          value={nf.format(members.data?.length ?? 0)}
          hint={group?.is_catchall ? "Catch-all: any category without a team" : "exp_category_group_members"}
        />
        <StatTile
          label="Territory slots"
          tone="purple"
          loading={slots.isLoading}
          value={nf.format(rows.length)}
          hint={`${rows.length - openSlots.length} assigned · ${openSlots.length} open`}
        />
        <StatTile
          label="Book volume"
          tone="green"
          icon={<Users className="h-4 w-4" />}
          loading={slots.isLoading}
          value={nf.format(rows.reduce((s, t) => s + Number(t.agent_count ?? 0), 0))}
          hint={`${nf.format(rows.reduce((s, t) => s + Number(t.brand_count ?? 0), 0))} brands · ${nf.format(
            rows.reduce((s, t) => s + Number(t.office_count ?? 0), 0),
          )} offices`}
        />
        <StatTile
          label="Team quota (this month)"
          tone="yellow"
          loading={board.isLoading}
          value={board.data?.totals.target ? cf.format(board.data.totals.target) : "—"}
          hint={
            board.data?.totals.pct != null
              ? `${Math.round(board.data.totals.pct)}% attained`
              : "no quota rows for this group yet"
          }
        />
      </div>

      {/* Members editor */}
      <Panel
        title="Member categories"
        description="Add or remove gcids. After a change, regenerate territories so volume and slot counts follow."
        bodyClassName="px-3 py-3"
      >
        <div className="mb-3 flex flex-wrap gap-2 px-1">
          {(members.data ?? []).map((m: GroupMember) => (
            <span
              key={m.id}
              className="flex items-center gap-2 rounded-full border border-[color:var(--color-hairline)] px-3 py-1 text-sm"
            >
              <span className="font-medium text-ink">{m.label}</span>
              <span className="font-mono text-[11px] text-[color:var(--color-ink-3)]">{m.gcid}</span>
              <button
                type="button"
                aria-label={`Remove ${m.label}`}
                onClick={() => dropMember.mutate(m.id)}
                className="text-[color:var(--color-ink-3)] hover:text-[#c5221f]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {!members.isLoading && !(members.data ?? []).length ? (
            <span className="text-sm text-[color:var(--color-ink-3)]">
              No categories in this group yet.
            </span>
          ) : null}
        </div>
        <div className="px-1">
          <Label htmlFor="catsearch" className="text-xs">
            Add a category
          </Label>
          <Input
            id="catsearch"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search gbp_categories by name or gcid…"
            className="mt-1 h-9 max-w-md"
          />
          {term.trim().length >= 2 ? (
            <div className="mt-2 max-h-56 max-w-md overflow-auto rounded-xl border border-[color:var(--color-hairline)]">
              {(search.data ?? []).map((c) => (
                <button
                  key={c.gcid}
                  type="button"
                  onClick={() => {
                    addMember.mutate(c.gcid);
                    setTerm("");
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[color:var(--color-surface-2)]"
                >
                  <span>{c.label}</span>
                  <span className="font-mono text-[11px] text-[color:var(--color-ink-3)]">{c.gcid}</span>
                </button>
              ))}
              {search.isFetched && !(search.data ?? []).length ? (
                <p className="px-3 py-2 text-sm text-[color:var(--color-ink-3)]">No match.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Panel>

      {/* Territory slots by tier */}
      <div className="mt-6 grid gap-6">
        {slots.isLoading ? (
          <Panel title="Territory slots">
            <p className="text-sm text-[color:var(--color-ink-3)]">Loading…</p>
          </Panel>
        ) : !rows.length ? (
          <Panel title="Territory slots">
            <EmptyState
              title="No territories generated yet"
              description="Use Regenerate territories to build slots from real volume across the group's member categories."
            />
          </Panel>
        ) : (
          byTier.map(([tier, list]) => (
            <Panel
              key={tier}
              title={`${TIER_LABEL[tier] ?? tier} slots`}
              description={`${list.length} slot${list.length === 1 ? "" : "s"} · ${list.filter((s) => s.seller_id).length} assigned`}
              bodyClassName="px-3 py-2"
            >
              <DataTable<TerritorySlot>
                rows={list}
                getRowKey={(r) => r.id}
                empty={<EmptyState title="No slots" compact />}
                columns={[
                  {
                    key: "l",
                    header: "Territory",
                    cell: (r) => (
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium text-ink">{r.label}</span>
                        <TierChip tier={r.tier} />
                      </span>
                    ),
                  },
                  {
                    key: "s",
                    header: "Seller",
                    cell: (r) =>
                      r.seller_id ? (
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{repName(r.seller_id) ?? r.seller_id.slice(0, 8)}</span>
                          {reps.data?.find((x) => x.id === r.seller_id)?.is_demo ? <DemoChip /> : null}
                        </span>
                      ) : (
                        <span className="text-[color:var(--color-ink-3)]">Unassigned</span>
                      ),
                  },
                  { key: "b", header: "Brands", align: "right", cell: (r) => nf.format(r.brand_count ?? 0) },
                  { key: "o", header: "Offices", align: "right", cell: (r) => nf.format(r.office_count ?? 0) },
                  { key: "a", header: "Agents", align: "right", cell: (r) => nf.format(r.agent_count ?? 0) },
                  {
                    key: "q",
                    header: "Quota",
                    align: "right",
                    cell: (r) => {
                      const q = quotaFor(r.seller_id);
                      return q ? cf.format(q) : "—";
                    },
                  },
                  { key: "st", header: "Status", cell: (r) => r.status },
                  {
                    key: "act",
                    header: "",
                    align: "right",
                    cell: (r) => (
                      <span className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSlotId(r.id);
                            setRepId(r.seller_id ?? "");
                            setQuota(String(quotaFor(r.seller_id) ?? 50000));
                            setOnboard(true);
                          }}
                        >
                          {r.seller_id ? "Reassign" : "Assign"}
                        </Button>
                        {r.seller_id ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => unassign.mutate(r.id)}
                            disabled={unassign.isPending}
                          >
                            Unassign
                          </Button>
                        ) : null}
                      </span>
                    ),
                  },
                ]}
              />
            </Panel>
          ))
        )}
      </div>

      {/* Consolidated team scorecard */}
      <Panel
        className="mt-6"
        title="Consolidated team scorecard"
        description="Quota, funnel, pipeline and revenue aggregated across ALL member categories of this group (by group_key)."
      >
        {board.isLoading ? (
          <p className="text-sm text-[color:var(--color-ink-3)]">Loading…</p>
        ) : !board.data?.sellers.length ? (
          <EmptyState
            title="No sellers reporting into this group yet"
            description="Assign a territory slot, or wait for exp_sales_rep_metrics / exp_sales_quotas rows carrying this group_key."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {board.data.sellers.map((c) => (
              <SellerCardView key={c.repId} card={c} />
            ))}
          </div>
        )}
        {board.data?.allDemo ? (
          <p className="mt-3 text-xs text-[color:var(--color-ink-3)]">
            Every row on this scorecard is demo-flagged — treat it as a sandbox, not the real book.
          </p>
        ) : null}
      </Panel>

      {/* Seller availability */}
      <Panel
        className="mt-6"
        title="Seller availability"
        description="Off duty routes that territory's inbound to the backup rep, else the round-robin pool."
        bodyClassName="px-3 py-2"
      >
        <DataTable<TerritoryRep>
          loading={reps.isLoading}
          rows={(reps.data ?? []).filter((r) => assignedReps.includes(r.id) || r.group_key === groupKey)}
          getRowKey={(r) => r.id}
          empty={<EmptyState title="No sellers on this group yet" compact />}
          columns={[
            {
              key: "n",
              header: "Seller",
              cell: (r) => (
                <span className="flex items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  {r.is_demo ? <DemoChip /> : null}
                </span>
              ),
            },
            { key: "r", header: "Role", cell: (r) => r.role },
            {
              key: "d",
              header: "On duty",
              cell: (r) => (
                <Switch
                  checked={r.on_duty !== false}
                  onCheckedChange={(v) => duty.mutate({ id: r.id, on: v })}
                />
              ),
            },
            {
              key: "b",
              header: "Backup",
              cell: (r) => (
                <Select
                  value={r.backup_rep_id ?? "none"}
                  onValueChange={(v) => backup.mutate({ id: r.id, backup: v === "none" ? null : v })}
                >
                  <SelectTrigger className="h-8 w-[200px]">
                    <SelectValue placeholder="No backup" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No backup</SelectItem>
                    {(reps.data ?? [])
                      .filter((x) => x.id !== r.id)
                      .map((x) => (
                        <SelectItem key={x.id} value={x.id}>
                          {x.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ),
            },
          ]}
        />
      </Panel>

      {/* Routing rules */}
      <Panel className="mt-6" title="Routing rules" description="From exp_territory_rules — read-only.">
        <div className="grid gap-3 md:grid-cols-2">
          {explain.map((e) => (
            <div key={e.lane} className="rounded-xl border border-[color:var(--color-hairline)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-ink-3)]">
                {e.lane} lane
              </p>
              <p className="mt-1 text-sm font-medium text-ink">{e.trigger}</p>
              <p className="mt-1 text-sm text-[color:var(--color-ink-2)]">→ {e.destination}</p>
              <p className="mt-1 text-xs text-[color:var(--color-ink-3)]">{e.fallback}</p>
            </div>
          ))}
        </div>
      </Panel>

      {/* Onboarding dialog */}
      <Dialog open={onboard} onOpenChange={setOnboard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign a seller to a territory</DialogTitle>
            <DialogDescription>
              The quota is written to exp_sales_quotas with group_key “{groupKey}”, so reporting
              consolidates across every category in the bundle.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label className="text-xs">Territory slot</Label>
              <Select value={slotId} onValueChange={setSlotId}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder={openSlots.length ? "Choose a slot" : "No open slots"} />
                </SelectTrigger>
                <SelectContent>
                  {rows.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label} · {s.tier}
                      {s.seller_id ? " (assigned)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Seller</Label>
              <Select value={repId} onValueChange={setRepId}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="Choose a seller" />
                </SelectTrigger>
                <SelectContent>
                  {(reps.data ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} · {r.role}
                      {r.is_demo ? " (demo)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="quota" className="text-xs">
                Monthly quota target (USD)
              </Label>
              <Input
                id="quota"
                inputMode="numeric"
                value={quota}
                onChange={(e) => setQuota(e.target.value)}
                className="mt-1 h-9"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOnboard(false)}>
              Cancel
            </Button>
            <Button
              disabled={!slotId || !repId || assign.isPending}
              onClick={() =>
                assign.mutate({
                  territoryId: slotId,
                  repId,
                  quotaTarget: Number(quota) || null,
                })
              }
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}

/* ─────────── Seller card (reuses the performance-board language) ─────────── */

function SellerCardView({ card }: { card: GroupSellerCard }) {
  const pct = card.pct;
  const tone =
    pct == null
      ? { bar: "bg-[color:var(--color-ink-3)]", text: "text-[color:var(--color-ink-2)]" }
      : pct >= 100
        ? { bar: "bg-[#1e8e3e]", text: "text-[#1e8e3e]" }
        : pct >= 80
          ? { bar: "bg-[#f9ab00]", text: "text-[#b06000]" }
          : { bar: "bg-[#c5221f]", text: "text-[#c5221f]" };

  const steps: [string, number][] = [
    ["Views", card.funnel.views],
    ["Attempted", card.funnel.attemptedClaims],
    ["Claims", card.funnel.claims],
    ["Engaged 30d", card.funnel.engaged30d],
    ["Logo signals", card.funnel.logoSignals],
    ["Demos booked", card.funnel.demosBooked],
    ["Attended", card.funnel.demosAttended],
    ["Closings", card.funnel.closings],
    ["Upgrades", card.funnel.upgrades],
  ];

  return (
    <div className="rounded-2xl border border-[color:var(--color-hairline)] bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-ink">{card.name}</p>
          <p className="text-xs uppercase tracking-wide text-[color:var(--color-ink-3)]">{card.role}</p>
        </div>
        <div className="text-right">
          <p className={`text-3xl font-semibold tabular-nums ${tone.text}`}>
            {pct == null ? "—" : `${Math.round(pct)}%`}
          </p>
          <p className="text-[11px] text-[color:var(--color-ink-3)]">quota attainment</p>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
        <div className={`h-full ${tone.bar}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </div>
      <p className="mt-1 text-xs text-[color:var(--color-ink-2)]">
        {cf.format(card.actual)} of {card.target ? cf.format(card.target) : "—"} ·{" "}
        {card.funnel.revenue ? `${cf.format(card.funnel.revenue)} revenue` : "no revenue rows"}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        {steps.map(([label, v]) => (
          <div key={label} className="rounded-lg bg-[color:var(--color-surface-2)] px-2 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-[color:var(--color-ink-3)]">{label}</p>
            <p className="font-mono text-sm text-ink">{nf.format(v)}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[color:var(--color-ink-2)]">
        <span>
          Conversion{" "}
          <strong className="font-semibold text-ink">
            {card.conversion == null ? "—" : `${Math.round(card.conversion)}%`}
          </strong>
        </span>
        <span>Profiles {nf.format(card.profilesAssigned)}</span>
        <span>Logos {nf.format(card.logosAssigned)}</span>
        <span>Open pipeline {cf.format(card.pipelineOpen)}</span>
        {card.isDemo ? <DemoChip /> : null}
      </div>
      {card.territories.length ? (
        <p className="mt-2 font-mono text-[11px] text-[color:var(--color-ink-3)]">
          {card.territories.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
