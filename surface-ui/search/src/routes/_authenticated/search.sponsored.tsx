import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Lock, MapPin, Plus, Tag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Checkbox } from "@v3/ui/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@v3/ui/components/ui/tooltip";
import {
  DataTable,
  DetailDrawer,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/ui/components/console/primitives";
import { FieldRow, InstrumentNote, Pill } from "@v3/ui/components/website/bits";
import { ReadOnlyLock } from "@v3/ui/components/model-lock";
import { money, num } from "@v3/ui/lib/console-surfaces";
import { useRole } from "@v3/ui/lib/roles";
import {
  catLabel,
  loadSponsored,
  searchMutations,
  SLOT_CAP,
  viewsForCategory,
  volumeCharge,
  type SponsoredPricingRow,
  type SponsoredSlotRow,
} from "@v3/search/lib/search-console";

export const Route = createFileRoute("/_authenticated/search/sponsored")({
  head: () => ({
    meta: [
      { title: "Sponsored Search — Rate card & slots" },
      {
        name: "description",
        content:
          "Fixed category-economics rate card, three sponsored positions per category per zip, grandfathered price lock-in and a volume pricing controller.",
      },
      { property: "og:title", content: "Sponsored Search — Rate card & slots" },
      { property: "og:description", content: "Fixed tiers first — no auction." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SponsoredPage,
});

function LockedBadge({ slot }: { slot: SponsoredSlotRow }) {
  const since = slot.locked_at ? new Date(slot.locked_at).toLocaleDateString() : "—";
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-g-green-soft)] px-2 py-0.5 text-[11px] font-semibold text-[#1e8e3e]">
            <Lock className="h-3 w-3" />
            Locked {money(slot.locked_price)} — since {since}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          Grandfathered — this advertiser keeps this rate through any future increase.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SponsoredPage() {
  const role = useRole();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["search-sponsored"], queryFn: loadSponsored });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["search-sponsored"] });

  const labels = data?.labels ?? new Map<string, string>();
  const pricing = data?.pricing ?? [];
  const groups = data?.groups ?? [];
  const rollup = data?.rollup ?? [];
  const stats = data?.stats;

  /* ── rate card editing ── */
  const [editRow, setEditRow] = useState<SponsoredPricingRow | null>(null);
  const [edit, setEdit] = useState({ tier: "", spots: "", mode: "fixed", monthly: "", floor: "", per1k: "" });
  useEffect(() => {
    if (!editRow) return;
    setEdit({
      tier: editRow.tier ?? "",
      spots: String(editRow.spots ?? SLOT_CAP),
      mode: editRow.pricing_mode ?? "fixed",
      monthly: editRow.monthly_price == null ? "" : String(editRow.monthly_price),
      floor: editRow.floor_price == null ? "" : String(editRow.floor_price),
      per1k: editRow.price_per_1k_views == null ? "" : String(editRow.price_per_1k_views),
    });
  }, [editRow]);

  const savePricing = useMutation({
    mutationFn: async () => {
      if (!editRow) return;
      await searchMutations.updatePricing(editRow.id, {
        tier: edit.tier || null,
        spots: edit.spots ? Number(edit.spots) : null,
        pricing_mode: edit.mode,
        monthly_price: edit.monthly ? Number(edit.monthly) : null,
        floor_price: edit.floor ? Number(edit.floor) : null,
        price_per_1k_views: edit.per1k ? Number(edit.per1k) : null,
      });
      await role.logAudit("sponsored_pricing_update", editRow.id, { ...edit });
    },
    onSuccess: () => {
      toast.success("Rate card saved");
      setEditRow(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── slot assignment ── */
  const [slotRow, setSlotRow] = useState<SponsoredSlotRow | null>(null);
  const [adv, setAdv] = useState({ name: "", price: "", lock: true });
  useEffect(() => {
    if (!slotRow) return;
    setAdv({
      name: slotRow.advertiser_name ?? "",
      price: slotRow.price == null ? "" : String(slotRow.price),
      lock: slotRow.locked_price != null,
    });
  }, [slotRow]);

  const saveSlot = useMutation({
    mutationFn: async () => {
      if (!slotRow) return;
      await searchMutations.assignSlot(slotRow.id, {
        advertiser_name: adv.name.trim(),
        price: adv.price ? Number(adv.price) : null,
        status: "active",
        lock: adv.lock,
        pricing_mode: slotRow.pricing_mode ?? "fixed",
      });
      await role.logAudit("sponsored_slot_assign", slotRow.id, {
        advertiser: adv.name.trim(),
        price: adv.price,
        locked: adv.lock,
      });
    },
    onSuccess: () => {
      toast.success(adv.lock ? "Advertiser placed — rate locked in" : "Advertiser placed");
      setSlotRow(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const release = useMutation({
    mutationFn: async (id: string) => {
      await searchMutations.releaseSlot(id);
      await role.logAudit("sponsored_slot_release", id, {});
    },
    onSuccess: () => {
      toast.success("Slot released");
      setSlotRow(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── volume pricing controller ── */
  const volumeCards = pricing.filter((p) => (p.pricing_mode ?? "fixed") === "volume");
  const [volGcid, setVolGcid] = useState<string>("");
  const [volRate, setVolRate] = useState("");
  const volumeOptions = pricing;
  const selected = volumeOptions.find((p) => p.gcid === volGcid) ?? null;
  useEffect(() => {
    if (!volGcid && volumeOptions.length) setVolGcid(volumeOptions[0]!.gcid ?? "");
  }, [volGcid, volumeOptions]);
  useEffect(() => {
    setVolRate(selected?.price_per_1k_views == null ? "" : String(selected.price_per_1k_views));
  }, [selected?.id, selected?.price_per_1k_views]);

  const views = viewsForCategory(rollup, volGcid || null);
  const rateNum = volRate ? Number(volRate) : null;
  const charge = volumeCharge(views, rateNum);

  const saveVolume = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      await searchMutations.updatePricing(selected.id, {
        pricing_mode: "volume",
        price_per_1k_views: rateNum,
      });
      await role.logAudit("sponsored_volume_rate", selected.id, { price_per_1k_views: rateNum });
    },
    onSuccess: () => {
      toast.success("Volume rate saved");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PageBody>
      <PageHeader
        eyebrow="Search · Sponsored search"
        title="Sponsored slot manager"
        description="Fixed category-economics tiers first — there is no auction. Three positions per category per zip, and any advertiser who locks a rate keeps it."
        actions={role.isReadOnly ? <ReadOnlyLock /> : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Rate cards" value={num(stats?.rateCards ?? null)} icon={<Tag className="h-4 w-4" />} loading={isLoading} />
        <StatTile
          label="Slots sold"
          value={`${num(stats?.sold ?? 0)} / ${num(stats?.inventory ?? 0)}`}
          hint={`Cap ${SLOT_CAP} per category per zip`}
          tone="green"
          loading={isLoading}
        />
        <StatTile label="Rates locked in" value={num(stats?.locked ?? null)} icon={<Lock className="h-4 w-4" />} tone="purple" loading={isLoading} />
        <StatTile label="Committed monthly" value={money(stats?.committed ?? null)} tone="blue" loading={isLoading} />
      </div>

      <Panel
        className="mt-6"
        title="Rate card"
        description="Fixed monthly price per tier — category economics, not bidding."
        bodyClassName="px-3 py-2"
      >
        <DataTable<SponsoredPricingRow>
          columns={[
            { key: "cat", header: "Category", cell: (r) => <span className="font-medium text-ink">{catLabel(labels, r.gcid)}</span> },
            { key: "geo", header: "Geo", cell: (r) => r.geo_type ?? "—" },
            { key: "tier", header: "Tier", cell: (r) => r.tier ?? "—" },
            { key: "spots", header: "Spots", align: "right", cell: (r) => num(r.spots) },
            { key: "mode", header: "Mode", cell: (r) => <Pill value={r.pricing_mode ?? "fixed"} /> },
            { key: "price", header: "Monthly price", align: "right", cell: (r) => money(r.monthly_price) },
            { key: "floor", header: "Floor", align: "right", cell: (r) => money(r.floor_price) },
            {
              key: "per1k",
              header: "Per 1k views",
              align: "right",
              cell: (r) => (r.price_per_1k_views == null ? "—" : money(r.price_per_1k_views)),
            },
            {
              key: "act",
              header: "",
              align: "right",
              cell: (r) =>
                role.canEdit ? (
                  <Button size="sm" variant="outline" onClick={() => setEditRow(r)}>
                    Edit
                  </Button>
                ) : null,
            },
          ]}
          rows={pricing}
          getRowKey={(r) => r.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<Tag className="h-4 w-4" />}
              title="No rate cards yet"
              description="Instrument to activate — add a tier per category and geo type."
            />
          }
        />
      </Panel>

      <Panel
        className="mt-6"
        title="Sold slots"
        description={`Three positions per category per zip — the cap is the product.`}
      >
        {isLoading ? (
          <div className="h-24 animate-pulse rounded-[14px] bg-[color:var(--color-surface-2)]" />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<MapPin className="h-4 w-4" />}
            title="No sponsored slots yet"
            description="Instrument to activate — slots appear per category and zip as inventory is opened."
          />
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.key} className="rounded-[16px] border border-[color:var(--color-hairline)] p-4">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">{catLabel(labels, g.gcid)}</p>
                    <p className="text-xs text-[color:var(--color-ink-3)]">Zip {g.geo_value ?? "—"}</p>
                  </div>
                  <p className="text-xs text-[color:var(--color-ink-2)]">
                    <span className="font-semibold text-ink">
                      {g.sold} / {SLOT_CAP}
                    </span>{" "}
                    sold · {money(g.revenue)} committed
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {g.positions.map((p, i) => {
                    const taken = !!p && !!p.advertiser_name && p.status !== "open";
                    return (
                      <div
                        key={p?.id ?? `${g.key}-${i}`}
                        className={
                          "rounded-[14px] border p-3 " +
                          (taken
                            ? "border-[color:var(--color-hairline)] bg-card"
                            : "border-dashed border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)]")
                        }
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-ink-3)]">
                            Position {i + 1}
                          </span>
                          {taken ? <Pill value={p!.status} /> : <Pill value="open" />}
                        </div>
                        {taken ? (
                          <div className="mt-2 space-y-2">
                            <p className="truncate text-sm font-semibold text-ink">{p!.advertiser_name}</p>
                            <p className="text-sm text-[color:var(--color-ink-2)]">
                              {money(p!.locked_price ?? p!.price)} / mo
                            </p>
                            {p!.locked_price != null ? <LockedBadge slot={p!} /> : null}
                            {role.canEdit ? (
                              <Button size="sm" variant="outline" onClick={() => setSlotRow(p!)}>
                                Manage
                              </Button>
                            ) : null}
                          </div>
                        ) : (
                          <div className="mt-2 space-y-2">
                            <p className="text-xs text-[color:var(--color-ink-3)]">Open — available to sell</p>
                            {role.canEdit && p ? (
                              <Button size="sm" className="gap-1.5" onClick={() => setSlotRow(p)}>
                                <Plus className="h-3.5 w-3.5" /> Add advertiser
                              </Button>
                            ) : null}
                            {!p ? (
                              <p className="text-xs text-[color:var(--color-ink-3)]">
                                Not opened — no slot row exists for this position.
                              </p>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        className="mt-6"
        title="Volume pricing controller"
        description="Charge by measured demand: (page views ÷ 1,000) × price per 1k views. Once an advertiser locks, their rate is fixed."
      >
        {pricing.length === 0 ? (
          <EmptyState
            title="No categories priced yet"
            description="Instrument to activate — add a rate card row first."
            compact
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[320px_1fr] lg:items-start">
            <div className="space-y-4">
              <FieldRow label="Category">
                <Select value={volGcid} onValueChange={setVolGcid}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {volumeOptions.map((p) => (
                      <SelectItem key={p.id} value={p.gcid ?? p.id}>
                        {catLabel(labels, p.gcid)} · {p.tier ?? "—"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Price per 1,000 views ($)">
                <Input
                  type="number"
                  value={volRate}
                  disabled={!role.canEdit}
                  onChange={(e) => setVolRate(e.target.value)}
                  placeholder="8"
                />
              </FieldRow>
              <Button
                disabled={!role.canEdit || !selected || saveVolume.isPending}
                onClick={() => saveVolume.mutate()}
              >
                Save volume rate
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[16px] border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
                  Measured page views
                </p>
                <p className="mt-2 text-[26px] font-semibold leading-none text-ink">{num(views)}</p>
                <p className="mt-2 text-xs text-[color:var(--color-ink-3)]">All rollup days for this category</p>
              </div>
              <div className="rounded-[16px] border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
                  Rate
                </p>
                <p className="mt-2 text-[26px] font-semibold leading-none text-ink">
                  {rateNum == null ? "—" : `${money(rateNum)}/1k`}
                </p>
                <p className="mt-2 text-xs text-[color:var(--color-ink-3)]">
                  {volumeCards.length} category set to volume
                </p>
              </div>
              <div className="rounded-[16px] border border-[color:var(--color-g-blue)] bg-[color:var(--color-g-blue-soft)] p-4">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-g-blue)]">
                  <Calculator className="h-3.5 w-3.5" /> Monthly charge
                </p>
                <p className="mt-2 text-[26px] font-semibold leading-none text-[color:var(--color-g-blue)]">
                  {charge == null ? "—" : money(charge)}
                </p>
                <p className="mt-2 text-xs text-[color:var(--color-g-blue)]">
                  {views ? `${num(views)} ÷ 1,000 × ${money(rateNum)}` : "No measured views yet"}
                </p>
              </div>
            </div>
          </div>
        )}
      </Panel>

      <div className="mt-4">
        <InstrumentNote>
          Views come from the page-view rollup only. Charges shown are what a volume customer would owe on measured
          demand — no billing run is connected yet.
        </InstrumentNote>
      </div>

      {/* Rate card editor */}
      <DetailDrawer
        open={!!editRow}
        onOpenChange={(o) => !o && setEditRow(null)}
        title="Edit rate card"
        description={editRow ? `${catLabel(labels, editRow.gcid)} · ${editRow.geo_type ?? "—"}` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditRow(null)}>
              Cancel
            </Button>
            <Button disabled={savePricing.isPending} onClick={() => savePricing.mutate()}>
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <FieldRow label="Tier">
            <Input value={edit.tier} onChange={(e) => setEdit({ ...edit, tier: e.target.value })} />
          </FieldRow>
          <FieldRow label="Spots">
            <Input type="number" value={edit.spots} onChange={(e) => setEdit({ ...edit, spots: e.target.value })} />
          </FieldRow>
          <FieldRow label="Pricing mode">
            <Select value={edit.mode} onValueChange={(v) => setEdit({ ...edit, mode: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">fixed</SelectItem>
                <SelectItem value="volume">volume</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Monthly price ($)">
            <Input type="number" value={edit.monthly} onChange={(e) => setEdit({ ...edit, monthly: e.target.value })} />
          </FieldRow>
          <FieldRow label="Floor price ($)">
            <Input type="number" value={edit.floor} onChange={(e) => setEdit({ ...edit, floor: e.target.value })} />
          </FieldRow>
          <FieldRow label="Price per 1,000 views ($)">
            <Input type="number" value={edit.per1k} onChange={(e) => setEdit({ ...edit, per1k: e.target.value })} />
          </FieldRow>
        </div>
      </DetailDrawer>

      {/* Slot manager */}
      <DetailDrawer
        open={!!slotRow}
        onOpenChange={(o) => !o && setSlotRow(null)}
        title={slotRow?.advertiser_name ? "Manage slot" : "Add advertiser"}
        description={
          slotRow
            ? `${catLabel(labels, slotRow.gcid)} · zip ${slotRow.geo_value ?? "—"} · position ${slotRow.position ?? "—"}`
            : undefined
        }
        footer={
          <div className="flex justify-between gap-2">
            {slotRow?.advertiser_name ? (
              <Button
                variant="ghost"
                className="text-[#c5221f]"
                onClick={() => slotRow && release.mutate(slotRow.id)}
              >
                Release slot
              </Button>
            ) : (
              <span />
            )}
            <Button disabled={!adv.name.trim() || saveSlot.isPending} onClick={() => saveSlot.mutate()}>
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <FieldRow label="Advertiser name">
            <Input value={adv.name} onChange={(e) => setAdv({ ...adv, name: e.target.value })} placeholder="Summit Home Loans" />
          </FieldRow>
          <FieldRow label="Monthly price ($)">
            <Input type="number" value={adv.price} onChange={(e) => setAdv({ ...adv, price: e.target.value })} />
          </FieldRow>
          <label className="flex items-start gap-3 rounded-[14px] border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] p-3">
            <Checkbox checked={adv.lock} onCheckedChange={(v) => setAdv({ ...adv, lock: v === true })} />
            <span className="text-xs leading-relaxed text-[color:var(--color-ink-2)]">
              <span className="block font-semibold text-ink">Lock this rate</span>
              Grandfathered — this advertiser keeps this rate through any future increase.
            </span>
          </label>
          {slotRow?.locked_price != null ? <LockedBadge slot={slotRow} /> : null}
        </div>
      </DetailDrawer>
    </PageBody>
  );
}
