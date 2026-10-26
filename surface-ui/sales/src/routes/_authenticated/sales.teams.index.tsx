import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Building2, Layers, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
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
import { SELLER_ROLES, type SellerRole } from "@v3/sales/lib/sales";
import { AvatarStack, BrandAvatar, PersonAvatar } from "@v3/ui/components/sales/entity-avatar";
import { SellerSetupSheet } from "@v3/sales/components/sales/seller-setup-dialog";

import {
  assignSeller,
  loadAllBrandLinks,
  loadGroupTeams,
  loadReps,
  loadTeamsSummary,
  moveBrandTerritory,
  TIERS,
  TIER_LABEL,
  type TeamsSummary,
} from "@v3/sales/lib/teams";

export const Route = createFileRoute("/_authenticated/sales/teams/")({
  head: () => ({
    meta: [
      { title: "Teams & territory management — Experience.com Console" },
      {
        name: "description",
        content:
          "Active category groups, seller assignment by sales level, and moving brands between territory slots — all wired to live territory tables.",
      },
      { property: "og:title", content: "Teams & territory management — Experience.com Console" },
      {
        property: "og:description",
        content: "Assign sellers to territory slots, move logos between teams and see live coverage.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamsPage,
});

const nf = new Intl.NumberFormat("en-US");
const cf = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function DemoChip() {
  return (
    <span className="rounded-full bg-[#fff4d6] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8a5a00]">
      Demo
    </span>
  );
}

export function RealChip() {
  return (
    <span className="rounded-full bg-[#e7f5ec] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#1e8e3e]">
      Real
    </span>
  );
}

type GroupRow = TeamsSummary["groups"][number];

function TeamsPage() {
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ["teams-summary"], queryFn: loadTeamsSummary });
  const [assignOpen, setAssignOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const rows = summary.data?.groups ?? [];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["teams-summary"] });
    void qc.invalidateQueries({ queryKey: ["group-teams"] });
    void qc.invalidateQueries({ queryKey: ["brand-links"] });
  };

  return (
    <PageBody>
      <PageHeader
        eyebrow="Growth Hub · Module 1"
        title="Teams & territory management"
        description="A team owns a category group at one sales level. Slots, sellers, logos and profiles are read straight from the territory tables — nothing here is estimated."
        actions={
          <>
            <Button variant="outline" onClick={() => setMoveOpen(true)}>
              <ArrowRightLeft className="mr-2 h-4 w-4" /> Move brand
            </Button>
            <Button onClick={() => setSetupOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" /> Add seller
            </Button>
          </>
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Active categories"
          tone="blue"
          icon={<Layers className="h-4 w-4" />}
          loading={summary.isLoading}
          value={nf.format(summary.data?.activeCategories ?? 0)}
          hint={`${nf.format(summary.data?.territories ?? 0)} territory slots · ${nf.format(summary.data?.openSlots ?? 0)} open`}
        />
        <StatTile
          label="Sellers assigned"
          tone="green"
          icon={<Users className="h-4 w-4" />}
          loading={summary.isLoading}
          value={nf.format(summary.data?.sellersAssigned ?? 0)}
          hint="territories with a seller_id"
        />
        <StatTile
          label="Logos assigned"
          tone="purple"
          icon={<Building2 className="h-4 w-4" />}
          loading={summary.isLoading}
          value={nf.format(summary.data?.logosAssigned ?? 0)}
          hint="sum of territory brand_count"
        />
        <StatTile
          label="Profiles assigned"
          tone="yellow"
          loading={summary.isLoading}
          value={nf.format(summary.data?.profilesAssigned ?? 0)}
          hint="agents + offices stamped to a territory"
        />
      </div>

      <Panel
        title="Active categories"
        description="Category groups that already have generated territories. Open one to see every team inside it."
        bodyClassName="px-3 py-2"
      >
        <DataTable<GroupRow>
          loading={summary.isLoading}
          rows={rows}
          getRowKey={(g) => g.group.group_key}
          empty={
            <EmptyState
              title="No category has territories yet"
              description="Generate territory slots for a category group to activate it."
              compact
            />
          }
          columns={[
            {
              key: "g",
              header: "Category group",
              cell: (g) => (
                <span className="flex flex-wrap items-center gap-2">
                  {g.brandLogos.length ? (
                    <span className="flex items-center gap-1">
                      {g.brandLogos.slice(0, 3).map((b) => (
                        <BrandAvatar key={b.id} name={b.name} logoUrl={b.logoUrl} size="xs" />
                      ))}
                    </span>
                  ) : null}
                  <Link
                    to="/sales/teams/$groupKey"
                    params={{ groupKey: g.group.group_key }}
                    className="font-medium text-[color:var(--color-g-blue)] hover:underline"
                  >
                    {g.group.label}
                  </Link>
                  {g.isDemo ? <DemoChip /> : null}
                  {g.group.is_catchall ? (
                    <span className="rounded-full bg-[color:var(--color-surface-3)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--color-ink-2)]">
                      Catch-all
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              key: "sel",
              header: "Sellers",
              cell: (g) =>
                g.sellers.length ? <AvatarStack people={g.sellers} max={5} size="xs" /> : "—",
            },

            { key: "m", header: "Categories", align: "right", cell: (g) => nf.format(g.members) },
            {
              key: "t",
              header: "Teams",
              align: "right",
              cell: (g) => (
                <span>
                  {nf.format(g.assigned)}
                  <span className="text-[color:var(--color-ink-3)]"> / {nf.format(g.territories)}</span>
                </span>
              ),
            },
            { key: "b", header: "Logos", align: "right", cell: (g) => nf.format(g.brands) },
            { key: "o", header: "Offices", align: "right", cell: (g) => nf.format(g.offices) },
            { key: "a", header: "Agents", align: "right", cell: (g) => nf.format(g.agents) },
            {
              key: "x",
              header: "",
              align: "right",
              cell: (g) => (
                <Link
                  to="/sales/teams/$groupKey"
                  params={{ groupKey: g.group.group_key }}
                  className="text-xs font-medium text-[color:var(--color-g-blue)] hover:underline"
                >
                  Open category →
                </Link>
              ),
            },
          ]}
        />
      </Panel>

      <SellerSetupSheet
        repId={null}
        open={setupOpen}
        onOpenChange={setSetupOpen}
        onSaved={refresh}
      />

      <AssignSellerDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        groups={rows}
        onDone={refresh}
      />
      <MoveBrandDialog open={moveOpen} onOpenChange={setMoveOpen} onDone={refresh} />
    </PageBody>
  );
}

/* ─────────── Assign flow ─────────── */

export function AssignSellerDialog({
  open,
  onOpenChange,
  groups,
  fixedGroupKey,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groups?: GroupRow[];
  fixedGroupKey?: string;
  onDone?: () => void;
}) {
  const [groupKey, setGroupKey] = useState<string>(fixedGroupKey ?? "");
  const [tier, setTier] = useState<string>("");
  const [territoryId, setTerritoryId] = useState<string>("");
  const [repId, setRepId] = useState<string>("");
  const [quota, setQuota] = useState<string>("");

  const activeGroup = fixedGroupKey ?? groupKey;
  const reps = useQuery({ queryKey: ["teams-reps"], queryFn: loadReps, enabled: open });
  const teams = useQuery({
    queryKey: ["group-teams", activeGroup],
    queryFn: () => loadGroupTeams(activeGroup),
    enabled: open && !!activeGroup,
  });

  const slots = useMemo(
    () => (teams.data?.teams ?? []).filter((t) => (!tier || t.tier === tier) && !t.seller_id),
    [teams.data, tier],
  );
  const autoSlot = slots[0]?.id ?? "";

  const mut = useMutation({
    mutationFn: () =>
      assignSeller({
        territoryId: territoryId || autoSlot,
        groupKey: activeGroup,
        repId,
        quotaTarget: quota.trim() ? Number(quota) : null,
      }),
    onSuccess: () => {
      const slot = (teams.data?.teams ?? []).find((t) => t.id === (territoryId || autoSlot));
      toast.success(`Seller assigned to ${slot?.label ?? "territory"}`);
      onOpenChange(false);
      setTerritoryId("");
      setRepId("");
      setQuota("");
      onDone?.();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const canSubmit = !!activeGroup && !!repId && !!(territoryId || autoSlot);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add seller to a territory</DialogTitle>
          <DialogDescription>
            Pick the category group and sales level, then take the next open slot or a specific one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!fixedGroupKey ? (
            <div className="space-y-1.5">
              <Label>Category group</Label>
              <Select value={groupKey} onValueChange={(v) => { setGroupKey(v); setTerritoryId(""); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a category group" />
                </SelectTrigger>
                <SelectContent>
                  {(groups ?? []).map((g) => (
                    <SelectItem key={g.group.group_key} value={g.group.group_key}>
                      {g.group.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>Sales level</Label>
            <Select value={tier} onValueChange={(v) => { setTier(v); setTerritoryId(""); }}>
              <SelectTrigger>
                <SelectValue placeholder="Any level" />
              </SelectTrigger>
              <SelectContent>
                {TIERS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t} — {TIER_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Territory slot</Label>
            <Select value={territoryId} onValueChange={setTerritoryId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    autoSlot
                      ? `Auto-pick next open slot (${slots[0]?.label})`
                      : teams.isLoading
                        ? "Loading slots…"
                        : "No open slot at this level"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {slots.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label} · {s.tier}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Seller</Label>
            <Select value={repId} onValueChange={setRepId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a seller" />
              </SelectTrigger>
              <SelectContent>
                {(reps.data ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    <span className="flex items-center gap-2">
                      <PersonAvatar name={r.name} photoUrl={r.photo_url} size="xs" ring={false} />
                      <span>
                        {r.name} — {SELLER_ROLES[r.role as SellerRole]?.label ?? r.role}
                        {r.on_duty === false ? " (off duty)" : ""}
                      </span>
                    </span>
                  </SelectItem>
                ))}

              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Monthly quota target (optional)</Label>
            <Input
              value={quota}
              inputMode="numeric"
              placeholder="e.g. 40000"
              onChange={(e) => setQuota(e.target.value)}
            />
            <p className="text-xs text-[color:var(--color-ink-3)]">
              Written to exp_sales_quotas keyed on this group_key for the current month.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Assigning…" : "Assign seller"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────── Move brand between territories ─────────── */

export function MoveBrandDialog({
  open,
  onOpenChange,
  presetLinkId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  presetLinkId?: string;
  onDone?: () => void;
}) {
  const links = useQuery({ queryKey: ["brand-links"], queryFn: loadAllBrandLinks, enabled: open });
  const [linkId, setLinkId] = useState<string>(presetLinkId ?? "");
  const [toId, setToId] = useState<string>("");

  const link = (links.data ?? []).find((l) => l.id === (linkId || presetLinkId));
  const teams = useQuery({
    queryKey: ["group-teams", link?.group_key ?? ""],
    queryFn: () => loadGroupTeams(link?.group_key ?? ""),
    enabled: open && !!link?.group_key,
  });
  const destinations = (teams.data?.teams ?? []).filter(
    (t) => t.tier === link?.tier && t.id !== link?.territory_id,
  );

  const mut = useMutation({
    mutationFn: () =>
      moveBrandTerritory({
        linkId: link!.id,
        orgId: link!.org_id,
        fromTerritoryId: link!.territory_id,
        toTerritoryId: toId,
      }),
    onSuccess: () => {
      const dest = destinations.find((d) => d.id === toId);
      toast.success(
        `${link?.name} moved from ${link?.territoryLabel} to ${dest?.label ?? "new territory"} — offices, profiles and counts re-stamped.`,
      );
      onOpenChange(false);
      setToId("");
      onDone?.();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move a brand between territories</DialogTitle>
          <DialogDescription>
            Moves the logo and re-stamps its offices and profiles onto the destination team. Only slots
            in the same tier lane are offered.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Brand / logo</Label>
            <Select value={linkId} onValueChange={(v) => { setLinkId(v); setToId(""); }}>
              <SelectTrigger>
                <SelectValue placeholder={links.isLoading ? "Loading brands…" : "Choose a brand"} />
              </SelectTrigger>
              <SelectContent>
                {(links.data ?? []).map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    <span className="flex items-center gap-2">
                      <BrandAvatar name={l.name} logoUrl={l.logo_url} size="xs" />
                      <span>
                        {l.name} — {l.territoryLabel}
                      </span>
                    </span>
                  </SelectItem>
                ))}

              </SelectContent>
            </Select>
          </div>

          {link ? (
            <div className="rounded-xl border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] px-4 py-3 text-xs text-[color:var(--color-ink-2)]">
              Currently in <span className="font-mono text-ink">{link.territoryLabel}</span> ·{" "}
              {TIER_LABEL[link.tier] ?? link.tier} lane · {nf.format(link.offices)} offices ·{" "}
              {nf.format(link.profiles)} profiles
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>Move to</Label>
            <Select value={toId} onValueChange={setToId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !link
                      ? "Pick a brand first"
                      : destinations.length
                        ? "Choose destination territory"
                        : "No other slot in this tier lane"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label} {d.sellerName ? `· ${d.sellerName}` : "· unassigned"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!link || !toId || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Moving…" : "Move brand"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { cf };
