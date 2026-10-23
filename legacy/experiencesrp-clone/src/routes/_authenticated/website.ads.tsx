import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorPlay, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@/components/console/primitives";
import { FieldRow, InstrumentNote, Pill } from "@/components/website/bits";
import { loadAds, webMutations } from "@/lib/website";

const PLACEMENTS = ["in_app", "nora", "event", "external"];

export const Route = createFileRoute("/_authenticated/website/ads")({
  head: () => ({
    meta: [
      { title: "Ads — Website" },
      {
        name: "description",
        content:
          "Build and launch in-app ads, Nora ads, event ads and external ads with placement, creative, flight dates and budget versus spend.",
      },
      { property: "og:title", content: "Ads — Website" },
      { property: "og:description", content: "In-app, Nora, event and external ad units with budget pacing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdsPage,
});

function AdsPage() {
  const qc = useQueryClient();
  const { data: ads, isLoading } = useQuery({ queryKey: ["web-ads"], queryFn: loadAds });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["web-ads"] });

  const [name, setName] = useState("");
  const [placement, setPlacement] = useState("in_app");
  const [budget, setBudget] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");

  const create = useMutation({
    mutationFn: () =>
      webMutations.createAd({
        name: name.trim(),
        placement,
        budget: budget ? Number(budget) : null,
        starts_on: starts,
        ends_on: ends,
      }),
    onSuccess: () => {
      toast.success("Ad created as draft");
      setName("");
      setBudget("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patch = useMutation({
    mutationFn: (v: { id: string; status: string }) => webMutations.updateAd(v.id, { status: v.status }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => webMutations.deleteAd(id),
    onSuccess: () => {
      toast.success("Ad deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = ads ?? [];
  const live = list.filter((a) => a.status === "live").length;
  const budgetTotal = list.reduce((s, a) => s + Number(a.budget ?? 0), 0);
  const spendTotal = list.reduce((s, a) => s + Number(a.spend ?? 0), 0);
  const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Website · Ads"
        title="Ad units"
        description="One place to build and launch every ad surface — in-app, Nora, events and external — with flight dates and budget pacing."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Ad units" value={list.length} icon={<MonitorPlay className="h-4 w-4" />} loading={isLoading} />
        <StatTile label="Live" value={live} tone="green" loading={isLoading} />
        <StatTile label="Budget" value={money(budgetTotal)} tone="blue" loading={isLoading} />
        <StatTile
          label="Spend"
          value={money(spendTotal)}
          hint={budgetTotal ? `${((spendTotal / budgetTotal) * 100).toFixed(0)}% of budget` : undefined}
          tone="purple"
          loading={isLoading}
        />
      </div>

      <Panel className="mt-6" title="New ad unit">
        <div className="grid gap-4 md:grid-cols-5 md:items-end">
          <FieldRow label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nora upgrade banner" />
          </FieldRow>
          <FieldRow label="Placement">
            <Select value={placement} onValueChange={setPlacement}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLACEMENTS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Budget">
            <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="5000" />
          </FieldRow>
          <FieldRow label="Starts">
            <Input type="date" value={starts} onChange={(e) => setStarts(e.target.value)} />
          </FieldRow>
          <div className="flex items-end gap-3">
            <FieldRow label="Ends">
              <Input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
            </FieldRow>
            <Button className="gap-1.5" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
              <Plus className="h-4 w-4" /> Create
            </Button>
          </div>
        </div>
      </Panel>

      <Panel className="mt-6" title="Ad units" bodyClassName="px-3 py-2">
        <DataTable
          columns={[
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
            { key: "placement", header: "Placement", cell: (a) => <Pill value={a.placement} /> },
            { key: "budget", header: "Budget", align: "right", cell: (a) => money(Number(a.budget ?? 0)) },
            { key: "spend", header: "Spend", align: "right", cell: (a) => money(Number(a.spend ?? 0)) },
            { key: "status", header: "Status", cell: (a) => <Pill value={a.status} /> },
            {
              key: "act",
              header: "",
              align: "right",
              cell: (a) => (
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
              ),
            },
          ]}
          rows={list}
          getRowKey={(a) => a.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<MonitorPlay className="h-4 w-4" />}
              title="No ad units yet"
              description="Create the first unit; budget and flight dates are tracked here."
            />
          }
        />
      </Panel>

      <div className="mt-4">
        <InstrumentNote>
          Spend is stored on the ad row but no ad server is connected yet, so pacing only reflects values written here.
          Impression and click delivery become live once the ad platform feed is wired.
        </InstrumentNote>
      </div>
    </PageBody>
  );
}
