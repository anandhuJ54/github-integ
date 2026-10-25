import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Plus } from "lucide-react";
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
import { FieldRow, Pill } from "@v3/ui/components/website/bits";
import { loadCampaigns, webMutations } from "@v3/marketing/lib/website";

const CHANNELS = ["sdrcloud", "email", "outreach"];

export const Route = createFileRoute("/_authenticated/website/campaigns")({
  head: () => ({
    meta: [
      { title: "Campaigns — Website" },
      {
        name: "description",
        content:
          "Cohort outreach campaigns across SDRCloud, email and outreach: assign profiles, set the cohort and run the campaign from draft to live.",
      },
      { property: "og:title", content: "Campaigns — Website" },
      { property: "og:description", content: "Cohort outreach across SDRCloud, email and outreach channels." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CampaignsPage,
});

function CampaignsPage() {
  const qc = useQueryClient();
  const { data: campaigns, isLoading } = useQuery({ queryKey: ["web-campaigns"], queryFn: loadCampaigns });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["web-campaigns"] });

  const [name, setName] = useState("");
  const [cohort, setCohort] = useState("");
  const [channel, setChannel] = useState("sdrcloud");
  const [startsOn, setStartsOn] = useState("");

  const create = useMutation({
    mutationFn: () => webMutations.createCampaign({ name: name.trim(), cohort: cohort.trim(), channel, starts_on: startsOn }),
    onSuccess: () => {
      toast.success("Campaign created");
      setName("");
      setCohort("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patch = useMutation({
    mutationFn: (v: { id: string; status?: string; assigned_profiles?: number }) =>
      webMutations.updateCampaign(v.id, { status: v.status, assigned_profiles: v.assigned_profiles }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => webMutations.deleteCampaign(id),
    onSuccess: () => {
      toast.success("Campaign deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = campaigns ?? [];
  const live = list.filter((c) => c.status === "live").length;
  const profiles = list.reduce((s, c) => s + (c.assigned_profiles ?? 0), 0);

  return (
    <PageBody>
      <PageHeader
        eyebrow="Website · Campaigns"
        title="Cohort outreach"
        description="Build a campaign against a cohort, pick the channel, assign profiles, and run it. Reach and profile counts read live from the campaign table."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Campaigns" value={list.length} icon={<Megaphone className="h-4 w-4" />} loading={isLoading} />
        <StatTile label="Live" value={live} tone="green" loading={isLoading} />
        <StatTile label="Profiles assigned" value={profiles.toLocaleString()} tone="blue" loading={isLoading} />
      </div>

      <Panel className="mt-6" title="New campaign">
        <div className="grid gap-4 md:grid-cols-4 md:items-end">
          <FieldRow label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Insurance Q4 upgrade push" />
          </FieldRow>
          <FieldRow label="Cohort">
            <Input value={cohort} onChange={(e) => setCohort(e.target.value)} placeholder="unclaimed-insurance" />
          </FieldRow>
          <FieldRow label="Channel">
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <div className="flex items-end gap-3">
            <FieldRow label="Starts on">
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </FieldRow>
            <Button className="gap-1.5" disabled={!name.trim() || !cohort.trim() || create.isPending} onClick={() => create.mutate()}>
              <Plus className="h-4 w-4" /> Create
            </Button>
          </div>
        </div>
      </Panel>

      <Panel className="mt-6" title="Campaigns" bodyClassName="px-3 py-2">
        <DataTable
          columns={[
            {
              key: "name",
              header: "Campaign",
              cell: (c) => (
                <div>
                  <div className="font-medium text-ink">{c.name ?? "Untitled"}</div>
                  <div className="text-xs text-[color:var(--color-ink-3)]">cohort: {c.cohort ?? "—"}</div>
                </div>
              ),
            },
            { key: "channel", header: "Channel", cell: (c) => <Pill value={c.channel} /> },
            {
              key: "profiles",
              header: "Profiles",
              align: "right",
              cell: (c) => (
                <Input
                  type="number"
                  className="h-8 w-24 text-right"
                  defaultValue={c.assigned_profiles ?? 0}
                  onBlur={(e) => patch.mutate({ id: c.id, assigned_profiles: Number(e.target.value) || 0 })}
                />
              ),
            },
            { key: "starts", header: "Starts", cell: (c) => <span className="text-xs">{c.starts_on ?? "—"}</span> },
            { key: "status", header: "Status", cell: (c) => <Pill value={c.status} /> },
            {
              key: "act",
              header: "",
              align: "right",
              cell: (c) => (
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant={c.status === "live" ? "outline" : "default"}
                    onClick={() => patch.mutate({ id: c.id, status: c.status === "live" ? "paused" : "live" })}
                  >
                    {c.status === "live" ? "Pause" : "Launch"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-[#c5221f]" onClick={() => remove.mutate(c.id)}>
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
          rows={list}
          getRowKey={(c) => c.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<Megaphone className="h-4 w-4" />}
              title="No campaigns yet"
              description="Create the first cohort campaign; assigned profiles and status are tracked here."
            />
          }
        />
      </Panel>
    </PageBody>
  );
}
