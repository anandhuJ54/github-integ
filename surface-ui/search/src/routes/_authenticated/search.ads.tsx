import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorPlay, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import {
  DataTable,
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
  AD_CONTEXTS,
  AD_PLACEMENTS,
  CLAIM_CONVERSION_CONTEXT,
  catLabel,
  isClaimConversionUnit,
  loadLaunchedCategories,
  loadSearchAds,
  searchMutations,
  type SearchAdRow,
} from "@v3/search/lib/search-console";

const NONE = "__none";

export const Route = createFileRoute("/_authenticated/search/ads")({
  head: () => ({
    meta: [
      { title: "Ads Platform — Owned inventory" },
      {
        name: "description",
        content:
          "Owned display and native ad units by context, target category and geo, including the claim conversion unit that serves on unclaimed profile pages.",
      },
      { property: "og:title", content: "Ads Platform — Owned inventory" },
      { property: "og:description", content: "Claim conversion units on unclaimed profiles." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdsPlatformPage,
});

function AdsPlatformPage() {
  const role = useRole();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["search-ads"], queryFn: loadSearchAds });
  const { data: cats } = useQuery({ queryKey: ["launched-categories"], queryFn: loadLaunchedCategories });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["search-ads"] });

  const labels = data?.labels ?? new Map<string, string>();
  const ads = data?.ads ?? [];
  const stats = data?.stats;

  const [f, setF] = useState({
    name: "",
    context: CLAIM_CONVERSION_CONTEXT,
    placement: "in_app",
    gcid: NONE,
    geo: "",
    budget: "",
    starts: "",
    ends: "",
  });

  const create = useMutation({
    mutationFn: async () => {
      await searchMutations.createAd({
        name: f.name.trim(),
        placement: f.placement,
        context: f.context,
        target_gcid: f.gcid === NONE ? null : f.gcid,
        target_geo: f.geo.trim() || null,
        budget: f.budget ? Number(f.budget) : null,
        starts_on: f.starts,
        ends_on: f.ends,
      });
      await role.logAudit("search_ad_create", null, { name: f.name.trim(), context: f.context });
    },
    onSuccess: () => {
      toast.success("Ad unit created as draft");
      setF({ ...f, name: "", budget: "", geo: "" });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patch = useMutation({
    mutationFn: async (v: { id: string; status: string }) => {
      await searchMutations.updateAd(v.id, { status: v.status });
      await role.logAudit("search_ad_status", v.id, { status: v.status });
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await searchMutations.deleteAd(id);
      await role.logAudit("search_ad_delete", id, {});
    },
    onSuccess: () => {
      toast.success("Ad unit deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PageBody>
      <PageHeader
        eyebrow="Search · Ads platform"
        title="Owned ad inventory"
        description="Display and native units we serve on our own surfaces. The highest-value unit is the claim conversion unit on unclaimed profile pages."
        actions={role.isReadOnly ? <ReadOnlyLock /> : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Ad units" value={num(stats?.total ?? null)} icon={<MonitorPlay className="h-4 w-4" />} loading={isLoading} />
        <StatTile label="Live" value={num(stats?.live ?? null)} tone="green" loading={isLoading} />
        <StatTile
          label="Claim conversion units"
          value={num(stats?.claimUnits ?? null)}
          hint="Serve on unclaimed profiles"
          icon={<Sparkles className="h-4 w-4" />}
          tone="purple"
          loading={isLoading}
        />
        <StatTile
          label="Budget vs spend"
          value={`${money(stats?.budget ?? 0)} / ${money(stats?.spend ?? 0)}`}
          tone="blue"
          loading={isLoading}
        />
      </div>

      <div className="mt-6 rounded-[20px] border border-[color:var(--color-g-purple-soft)] bg-[color:var(--color-g-purple-soft)] p-5">
        <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7b4ce0]">
          <Sparkles className="h-3.5 w-3.5" /> Highest-value unit
        </p>
        <p className="mt-2 text-sm font-semibold text-ink">Claim conversion unit — unclaimed profile pages</p>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[color:var(--color-ink-2)]">
          “This profile is unclaimed — claim it / advertise here.” It converts our own traffic into claims and into
          sponsored demand, so it takes priority over every other context.
        </p>
      </div>

      {role.canEdit ? (
        <Panel className="mt-6" title="New ad unit">
          <div className="grid gap-4 md:grid-cols-4">
            <FieldRow label="Name">
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Claim your profile — banner" />
            </FieldRow>
            <FieldRow label="Context">
              <Select value={f.context} onValueChange={(v) => setF({ ...f, context: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AD_CONTEXTS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Placement">
              <Select value={f.placement} onValueChange={(v) => setF({ ...f, placement: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AD_PLACEMENTS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Target category">
              <Select value={f.gcid} onValueChange={(v) => setF({ ...f, gcid: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>All categories</SelectItem>
                  {(cats ?? []).map((c) => (
                    <SelectItem key={c.gcid} value={c.gcid}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Target geo (zip)">
              <Input value={f.geo} onChange={(e) => setF({ ...f, geo: e.target.value })} placeholder="94301" />
            </FieldRow>
            <FieldRow label="Budget ($)">
              <Input type="number" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
            </FieldRow>
            <FieldRow label="Starts">
              <Input type="date" value={f.starts} onChange={(e) => setF({ ...f, starts: e.target.value })} />
            </FieldRow>
            <div className="flex items-end gap-3">
              <FieldRow label="Ends">
                <Input type="date" value={f.ends} onChange={(e) => setF({ ...f, ends: e.target.value })} />
              </FieldRow>
              <Button className="gap-1.5" disabled={!f.name.trim() || create.isPending} onClick={() => create.mutate()}>
                <Plus className="h-4 w-4" /> Create
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel className="mt-6" title="Ad units" bodyClassName="px-3 py-2">
        <DataTable<SearchAdRow>
          columns={[
            {
              key: "context",
              header: "Context",
              cell: (a) => (
                <div className="flex items-center gap-2">
                  <Pill value={(a.context ?? "—").replace(/_/g, " ")} />
                  {isClaimConversionUnit(a) ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-g-purple-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#7b4ce0]">
                      <Sparkles className="h-3 w-3" /> Claim unit
                    </span>
                  ) : null}
                </div>
              ),
            },
            {
              key: "name",
              header: "Ad",
              cell: (a) => (
                <div>
                  <div className="font-medium text-ink">{a.name ?? "Untitled"}</div>
                  <div className="text-xs text-[color:var(--color-ink-3)]">
                    {a.starts_on ?? "—"} → {a.ends_on ?? "—"}
                  </div>
                </div>
              ),
            },
            { key: "cat", header: "Target category", cell: (a) => (a.target_gcid ? catLabel(labels, a.target_gcid) : "All") },
            { key: "geo", header: "Target geo", cell: (a) => a.target_geo ?? "All" },
            { key: "placement", header: "Placement", cell: (a) => <Pill value={a.placement} /> },
            { key: "budget", header: "Budget", align: "right", cell: (a) => money(a.budget) },
            { key: "spend", header: "Spend", align: "right", cell: (a) => money(a.spend) },
            { key: "status", header: "Status", cell: (a) => <Pill value={a.status} /> },
            {
              key: "act",
              header: "",
              align: "right",
              cell: (a) =>
                role.canEdit ? (
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant={a.status === "live" ? "outline" : "default"}
                      onClick={() => patch.mutate({ id: a.id, status: a.status === "live" ? "paused" : "live" })}
                    >
                      {a.status === "live" ? "Pause" : "Launch"}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-[#c5221f]" onClick={() => remove.mutate(a.id)}>
                      Delete
                    </Button>
                  </div>
                ) : null,
            },
          ]}
          rows={ads}
          getRowKey={(a) => a.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<MonitorPlay className="h-4 w-4" />}
              title="No ad units yet"
              description="Instrument to activate — create the claim conversion unit first; it serves on unclaimed profile pages."
            />
          }
        />
      </Panel>

      <div className="mt-4">
        <InstrumentNote>
          Spend is stored on the unit. Impressions, clicks and claim attribution appear once the ad serving feed on the
          public pages is wired.
        </InstrumentNote>
      </div>
    </PageBody>
  );
}
